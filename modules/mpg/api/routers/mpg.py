# =============================================================================
# routers/mpg.py — Vehicles module: MPG / fuel log
# thrive module `vehicles`
#
# Fill-up tracking with per-vehicle stats and nearby-station lookup via
# OpenStreetMap Overpass. Vision-powered digit extraction (snap the odometer /
# pump, crop the numbers, let a local vision model read them) now lives in the
# standalone `lmstudio` module — the frontend calls /api/lmstudio/vision and
# posts the kept crops back here as `images`.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrive.db)
#   • owns `mpg_entries` and `mpg_entry_images`
# =============================================================================
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
import os, math
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/mpg", tags=["mpg"])


# ── db init ────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_entries (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                date      TEXT    NOT NULL,
                odometer  REAL    NOT NULL,
                gallons   REAL    NOT NULL,
                ppg       REAL,
                total     REAL,
                miles     REAL,
                mpg       REAL,
                notes     TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # saved enhanced crops (what the vision model read) per fill-up.
        # A side table keeps the base64 out of the common list/stats queries.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mpg_entry_images (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                entry_id   INTEGER NOT NULL,
                kind       TEXT,            -- 'odometer' | 'total' | 'gallons'
                b64        TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mpg_img_entry ON mpg_entry_images(entry_id)")
        existing = {r["name"] for r in conn.execute("PRAGMA table_info(mpg_entries)").fetchall()}
        for col, decl in (
            ("lat",        "REAL"),
            ("lng",        "REAL"),
            ("station",    "TEXT"),
            ("vehicle_id", "INTEGER REFERENCES vehicles(id) ON DELETE SET NULL"),
        ):
            if col not in existing:
                conn.execute(f"ALTER TABLE mpg_entries ADD COLUMN {col} {decl}")
        conn.commit()
    finally:
        conn.close()

init_db()


# ── schemas ────────────────────────────────────────────────────────────────
class EntryCreate(BaseModel):
    date:       str
    odometer:   float
    gallons:    float
    ppg:        Optional[float] = None
    total:      Optional[float] = None
    notes:      Optional[str]   = None
    lat:        Optional[float] = None
    lng:        Optional[float] = None
    station:    Optional[str]   = None
    vehicle_id: Optional[int]   = None
    # enhanced crops the model read, kept on log: {'odometer'|'total'|'gallons': b64}
    images:     Optional[dict]  = None


# ── helpers ────────────────────────────────────────────────────────────────
def recalc_from(conn, vehicle_id: Optional[int] = None):
    if vehicle_id is not None:
        rows = conn.execute(
            "SELECT id, odometer, gallons FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
            (vehicle_id,)
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, odometer, gallons FROM mpg_entries WHERE vehicle_id IS NULL ORDER BY date ASC, id ASC"
        ).fetchall()
    prev_odo = None
    for row in rows:
        miles = round(row["odometer"] - prev_odo, 2) if prev_odo is not None else None
        mpg   = round(miles / row["gallons"], 2) if (miles and row["gallons"] > 0) else None
        conn.execute("UPDATE mpg_entries SET miles=?, mpg=? WHERE id=?", (miles, mpg, row["id"]))
        prev_odo = row["odometer"]


# ── routes ─────────────────────────────────────────────────────────────────
@router.get("/stats")
def get_stats(vehicle_id: Optional[int] = Query(default=None)):
    conn = get_db()
    try:
        if vehicle_id is not None:
            rows = conn.execute(
                "SELECT mpg, gallons, total FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
                (vehicle_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT mpg, gallons, total FROM mpg_entries ORDER BY date ASC, id ASC"
            ).fetchall()
    finally:
        conn.close()
    valid   = [r["mpg"]   for r in rows if r["mpg"]   is not None]
    spent   = [r["total"] for r in rows if r["total"] is not None]
    gallons = [r["gallons"] for r in rows]
    return {
        "count":       len(rows),
        "last_mpg":    round(valid[-1], 2)               if valid   else None,
        "avg_mpg":     round(sum(valid) / len(valid), 2) if valid   else None,
        "total_gal":   round(sum(gallons), 2)            if gallons else None,
        "total_spent": round(sum(spent), 2)              if spent   else None,
    }


@router.get("")
def list_entries(vehicle_id: Optional[int] = Query(default=None)):
    conn = get_db()
    try:
        if vehicle_id is not None:
            rows = conn.execute(
                "SELECT * FROM mpg_entries WHERE vehicle_id=? ORDER BY date ASC, id ASC",
                (vehicle_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM mpg_entries ORDER BY date ASC, id ASC"
            ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


@router.post("", status_code=201)
def create_entry(entry: EntryCreate):
    conn = get_db()
    try:
        prev = conn.execute(
            """SELECT odometer FROM mpg_entries
               WHERE date <= ?
               AND (vehicle_id IS ? OR (? IS NULL AND vehicle_id IS NULL))
               ORDER BY date DESC, id DESC LIMIT 1""",
            (entry.date, entry.vehicle_id, entry.vehicle_id)
        ).fetchone()
        miles = round(entry.odometer - prev["odometer"], 2) if prev else None
        mpg   = round(miles / entry.gallons, 2) if (miles and entry.gallons > 0) else None
        total = entry.total or (round(entry.gallons * entry.ppg, 2) if entry.ppg else None)
        cur = conn.execute(
            """INSERT INTO mpg_entries
               (date, odometer, gallons, ppg, total, miles, mpg, notes, lat, lng, station, vehicle_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (entry.date, entry.odometer, entry.gallons, entry.ppg, total, miles, mpg,
             entry.notes, entry.lat, entry.lng, entry.station, entry.vehicle_id)
        )
        conn.commit()
        recalc_from(conn, entry.vehicle_id)
        conn.commit()
        # persist the enhanced crops the model read, if the client kept any
        if entry.images:
            for kind, b64 in entry.images.items():
                if b64:
                    conn.execute(
                        "INSERT INTO mpg_entry_images (entry_id, kind, b64) VALUES (?,?,?)",
                        (cur.lastrowid, kind, b64)
                    )
            conn.commit()
        row = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.get("/{entry_id}/images")
def entry_images(entry_id: int):
    """Saved enhanced crops for a fill-up (fetched on demand when a row expands)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT kind, b64 FROM mpg_entry_images WHERE entry_id=? ORDER BY id",
            (entry_id,)
        ).fetchall()
        return [{"kind": r["kind"], "b64": r["b64"]} for r in rows]
    finally:
        conn.close()


@router.patch("/{entry_id}")
def update_entry(entry_id: int, entry: EntryCreate):
    conn = get_db()
    try:
        existing = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Entry not found")
        total = entry.total or (round(entry.gallons * entry.ppg, 2) if entry.ppg else None)
        conn.execute(
            """UPDATE mpg_entries
               SET date=?, odometer=?, gallons=?, ppg=?, total=?, notes=?,
                   lat=?, lng=?, station=?, vehicle_id=?
               WHERE id=?""",
            (entry.date, entry.odometer, entry.gallons, entry.ppg, total,
             entry.notes, entry.lat, entry.lng, entry.station, entry.vehicle_id, entry_id)
        )
        conn.commit()
        # recompute miles/mpg for both the old and new vehicle buckets in case
        # the vehicle assignment changed
        recalc_from(conn, existing["vehicle_id"])
        if entry.vehicle_id != existing["vehicle_id"]:
            recalc_from(conn, entry.vehicle_id)
        conn.commit()
        row = conn.execute("SELECT * FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT vehicle_id FROM mpg_entries WHERE id=?", (entry_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Entry not found")
        vehicle_id = row["vehicle_id"]
        conn.execute("DELETE FROM mpg_entry_images WHERE entry_id=?", (entry_id,))
        conn.execute("DELETE FROM mpg_entries WHERE id=?", (entry_id,))
        conn.commit()
        recalc_from(conn, vehicle_id)
        conn.commit()
    finally:
        conn.close()


# ── nearby fuel stations (OpenStreetMap / Overpass proxy) ────────────────────
OVERPASS_URLS = [
    os.environ.get("OVERPASS_URL", "https://overpass-api.de/api/interpreter"),
    "https://overpass.kumi.systems/api/interpreter",
]

def _haversine_m(lat1, lon1, lat2, lon2):
    R = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


@router.get("/nearby")
async def nearby_stations(lat: float, lng: float, radius: int = 1500):
    """Return nearby fuel stations from OpenStreetMap, closest first."""
    radius = max(100, min(radius, 3000))
    query = (
        f"[out:json][timeout:15];"
        f'(node["amenity"="fuel"](around:{radius},{lat},{lng});'
        f'way["amenity"="fuel"](around:{radius},{lat},{lng}););'
        f"out center tags 40;"
    )
    last_err = None
    elements = None
    for url in OVERPASS_URLS:
        try:
            async with httpx.AsyncClient(timeout=20.0, headers={"User-Agent": "thrive-mpg/1.0"}) as client:
                # GET with urlencoded ?data= is accepted by all Overpass instances;
                # some public mirrors 406 on form-POST bodies.
                r = await client.get(url, params={"data": query})
                r.raise_for_status()
                elements = r.json().get("elements", [])
            break
        except httpx.HTTPError as e:
            last_err = f"{url.split('/')[2]}: {str(e)[:80]}"
            continue

    if elements is None:
        # every mirror failed — tell the frontend so it can say "lookup failed"
        return {"stations": [], "error": last_err or "lookup failed"}

    out = []
    for el in elements:
        tags = el.get("tags", {})
        plat = el.get("lat") or (el.get("center") or {}).get("lat")
        plon = el.get("lon") or (el.get("center") or {}).get("lon")
        if plat is None or plon is None:
            continue
        name = (tags.get("name") or tags.get("brand") or tags.get("operator")
                or "Fuel station")
        dist = _haversine_m(lat, lng, plat, plon)
        out.append({
            "name":   name,
            "brand":  tags.get("brand"),
            "street": tags.get("addr:street"),
            "lat":    plat,
            "lng":    plon,
            "dist_m": round(dist),
        })
    out.sort(key=lambda s: s["dist_m"])
    return {"stations": out[:8]}
