# =============================================================================
# routers/vehicles.py — Vehicles module: profiles, oil changes, tire tracking
# thrive module `vehicles`
#
# Garage of household vehicles plus their maintenance: oil changes and tires.
# Fill-ups/MPG live in the sibling `mpg` router (mpg_entries table), which this
# router reads for current odometer + summaries.
#
# Self-contained per the module loader: reuses the platform DB helper so it
# shares the one thrive.db, and creates its tables in an idempotent
# init_db() at import time. The auth gate (main.py) already requires a signed-in
# account for every non-public path, so these routes don't re-check per call.
# =============================================================================
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from datetime import date

from routers.auth import get_db

router = APIRouter(prefix="/vehicles", tags=["vehicles"])


# ── db ─────────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        # one-time cleanup: the earlier `vehicles` placeholder module created an
        # incompatible table (a `name NOT NULL` column this schema never sets).
        # If that legacy table is still around and empty, drop it so the real
        # schema below can be created. Guarded on emptiness — never drops data.
        veh = conn.execute("PRAGMA table_info(vehicles)").fetchall()
        if veh:
            cols = {r["name"] for r in veh}
            # this schema never has a `name` column — its presence marks the legacy
            # placeholder table (which also had `name NOT NULL`, breaking inserts).
            legacy = "name" in cols
            empty  = conn.execute("SELECT COUNT(*) FROM vehicles").fetchone()[0] == 0
            if legacy and empty:
                conn.execute("DROP TABLE vehicles")
                conn.commit()

        conn.execute("""
            CREATE TABLE IF NOT EXISTS vehicles (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                nickname    TEXT,
                year        INTEGER,
                make        TEXT,
                model       TEXT,
                trim        TEXT,
                vin         TEXT,
                plate       TEXT,
                notes       TEXT,
                created_at  TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS oil_changes (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id        INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                date              TEXT    NOT NULL,
                odometer          REAL    NOT NULL,
                oil_type          TEXT,
                filter_brand      TEXT,
                next_due_date     TEXT,
                next_due_miles    REAL,
                notes             TEXT,
                created_at        TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tires (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                vehicle_id              INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
                position                TEXT    NOT NULL,
                brand                   TEXT,
                model                   TEXT,
                size                    TEXT,
                installed_date          TEXT,
                installed_miles         REAL,
                tread_depth             REAL,
                rotation_interval_miles REAL,
                next_rotation_miles     REAL,
                notes                   TEXT,
                created_at              TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
        # idempotent migration: add any missing columns. Covers fresh installs
        # (nothing missing) and upgrades from the earlier placeholder `vehicles`
        # table, which lacked nickname/trim/vin plus the status/disposition fields.
        existing = {r["name"] for r in conn.execute("PRAGMA table_info(vehicles)").fetchall()}
        for col, decl in (
            ("nickname",         "TEXT"),
            ("trim",             "TEXT"),
            ("vin",              "TEXT"),
            ("status",           "TEXT DEFAULT 'active'"),  # 'active' | 'former'
            ("disposed_date",    "TEXT"),
            ("disposed_price",   "REAL"),
            ("disposed_mileage", "REAL"),
            ("disposed_to",      "TEXT"),
            ("disposed_note",    "TEXT"),
            ("color",            "TEXT"),       # #36: per-vehicle accent colour
            ("sort_order",       "INTEGER"),    # #37: manual drag order (NULL → by id)
        ):
            if col not in existing:
                conn.execute(f"ALTER TABLE vehicles ADD COLUMN {col} {decl}")
        conn.commit()
    finally:
        conn.close()

init_db()


# ── schemas ────────────────────────────────────────────────────────────────
class VehicleCreate(BaseModel):
    nickname:         Optional[str]   = None
    year:             Optional[int]   = None
    make:             Optional[str]   = None
    model:            Optional[str]   = None
    trim:             Optional[str]   = None
    vin:              Optional[str]   = None
    plate:            Optional[str]   = None
    notes:            Optional[str]   = None
    color:            Optional[str]   = None     # #36: accent colour (hex)
    status:           Optional[str]   = "active"   # 'active' | 'former'
    disposed_date:    Optional[str]   = None
    disposed_price:   Optional[float] = None
    disposed_mileage: Optional[float] = None
    disposed_to:      Optional[str]   = None
    disposed_note:    Optional[str]   = None

class VehicleUpdate(VehicleCreate):
    pass

class VehicleOrder(BaseModel):
    ids: list[int]

class OilChangeCreate(BaseModel):
    date:           str
    odometer:       float
    oil_type:       Optional[str]   = None
    filter_brand:   Optional[str]   = None
    next_due_date:  Optional[str]   = None
    next_due_miles: Optional[float] = None
    notes:          Optional[str]   = None

class OilChangeUpdate(OilChangeCreate):
    pass

class TireCreate(BaseModel):
    position:               str
    brand:                  Optional[str]   = None
    model:                  Optional[str]   = None
    size:                   Optional[str]   = None
    installed_date:         Optional[str]   = None
    installed_miles:        Optional[float] = None
    tread_depth:            Optional[float] = None
    rotation_interval_miles:Optional[float] = None
    next_rotation_miles:    Optional[float] = None
    notes:                  Optional[str]   = None

class TireUpdate(TireCreate):
    pass


# ── helpers ────────────────────────────────────────────────────────────────
def _due_status(next_date: Optional[str], next_miles: Optional[float], current_miles: Optional[float]):
    """Return ('ok'|'soon'|'overdue'|None, detail_str)"""
    flags = []

    if next_date:
        days_left = (date.fromisoformat(next_date) - date.today()).days
        if days_left < 0:
            flags.append(("overdue", f"{abs(days_left)}d overdue"))
        elif days_left <= 30:
            flags.append(("soon", f"due in {days_left}d"))

    if next_miles is not None and current_miles is not None:
        miles_left = next_miles - current_miles
        if miles_left < 0:
            flags.append(("overdue", f"{abs(int(miles_left))} mi overdue"))
        elif miles_left <= 500:
            flags.append(("soon", f"{int(miles_left)} mi left"))

    if not flags:
        return None, None
    # worst wins
    status = "overdue" if any(f[0] == "overdue" for f in flags) else "soon"
    detail = " · ".join(f[1] for f in flags)
    return status, detail


# ── vehicle routes ─────────────────────────────────────────────────────────
@router.get("")
def list_vehicles():
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM vehicles ORDER BY (status='former'), COALESCE(sort_order, id) ASC, id ASC"
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@router.put("/order")
def reorder_vehicles(body: VehicleOrder):
    """Persist a manual vehicle order (#37) — drag-to-reorder sends the full list
    of ids in the desired order; sort_order is assigned by index."""
    conn = get_db()
    try:
        for idx, vid in enumerate(body.ids):
            conn.execute("UPDATE vehicles SET sort_order=? WHERE id=?", (idx, vid))
        conn.commit()
        return {"ok": True, "count": len(body.ids)}
    finally:
        conn.close()

@router.post("", status_code=201)
def create_vehicle(v: VehicleCreate):
    conn = get_db()
    try:
        cur = conn.execute(
            """INSERT INTO vehicles
               (nickname,year,make,model,trim,vin,plate,notes,color,
                status,disposed_date,disposed_price,disposed_mileage,disposed_to,disposed_note)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (v.nickname, v.year, v.make, v.model, v.trim, v.vin, v.plate, v.notes, v.color,
             v.status or "active", v.disposed_date, v.disposed_price, v.disposed_mileage,
             v.disposed_to, v.disposed_note)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM vehicles WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)
    finally:
        conn.close()

@router.patch("/{vehicle_id}")
def update_vehicle(vehicle_id: int, v: VehicleUpdate):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Vehicle not found")
        conn.execute(
            """UPDATE vehicles SET
               nickname=?,year=?,make=?,model=?,trim=?,vin=?,plate=?,notes=?,color=?,
               status=?,disposed_date=?,disposed_price=?,disposed_mileage=?,disposed_to=?,disposed_note=?
               WHERE id=?""",
            (v.nickname, v.year, v.make, v.model, v.trim, v.vin, v.plate, v.notes, v.color,
             v.status or "active", v.disposed_date, v.disposed_price, v.disposed_mileage,
             v.disposed_to, v.disposed_note, vehicle_id)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM vehicles WHERE id=?", (vehicle_id,)).fetchone())
    finally:
        conn.close()

@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: int):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Vehicle not found")
        conn.execute("DELETE FROM vehicles WHERE id=?", (vehicle_id,))
        conn.commit()
    finally:
        conn.close()

@router.get("/{vehicle_id}/summary")
def vehicle_summary(vehicle_id: int):
    conn = get_db()
    try:
        v = conn.execute("SELECT * FROM vehicles WHERE id=?", (vehicle_id,)).fetchone()
        if not v:
            raise HTTPException(status_code=404, detail="Vehicle not found")

        # latest odometer from mpg_entries (created by the mpg router; guard in
        # case the mpg router hasn't run its init_db yet)
        current_miles = None
        try:
            odo_row = conn.execute(
                "SELECT odometer FROM mpg_entries WHERE vehicle_id=? ORDER BY date DESC, id DESC LIMIT 1",
                (vehicle_id,)
            ).fetchone()
            current_miles = odo_row["odometer"] if odo_row else None
        except Exception:
            pass

        # latest oil change
        oil = conn.execute(
            "SELECT * FROM oil_changes WHERE vehicle_id=? ORDER BY date DESC, id DESC LIMIT 1",
            (vehicle_id,)
        ).fetchone()
        oil_status, oil_detail = (None, None)
        if oil:
            oil_status, oil_detail = _due_status(oil["next_due_date"], oil["next_due_miles"], current_miles)

        # tires — next rotation due across all positions
        tires = conn.execute(
            "SELECT * FROM tires WHERE vehicle_id=? ORDER BY position ASC",
            (vehicle_id,)
        ).fetchall()
        rotation_status, rotation_detail = None, None
        for t in tires:
            s, d = _due_status(None, t["next_rotation_miles"], current_miles)
            if s == "overdue" or (s == "soon" and rotation_status != "overdue"):
                rotation_status, rotation_detail = s, d

        return {
            "vehicle":          dict(v),
            "current_miles":    current_miles,
            "oil_status":       oil_status,
            "oil_detail":       oil_detail,
            "last_oil_change":  dict(oil) if oil else None,
            "rotation_status":  rotation_status,
            "rotation_detail":  rotation_detail,
            "tire_count":       len(tires),
        }
    finally:
        conn.close()


# ── oil change routes ──────────────────────────────────────────────────────
@router.get("/{vehicle_id}/oil")
def list_oil_changes(vehicle_id: int):
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM oil_changes WHERE vehicle_id=? ORDER BY date DESC, id DESC",
            (vehicle_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@router.post("/{vehicle_id}/oil", status_code=201)
def add_oil_change(vehicle_id: int, o: OilChangeCreate):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Vehicle not found")
        cur = conn.execute(
            """INSERT INTO oil_changes
               (vehicle_id,date,odometer,oil_type,filter_brand,next_due_date,next_due_miles,notes)
               VALUES (?,?,?,?,?,?,?,?)""",
            (vehicle_id, o.date, o.odometer, o.oil_type, o.filter_brand,
             o.next_due_date, o.next_due_miles, o.notes)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM oil_changes WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.patch("/{vehicle_id}/oil/{oil_id}")
def update_oil_change(vehicle_id: int, oil_id: int, o: OilChangeUpdate):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM oil_changes WHERE id=? AND vehicle_id=?", (oil_id, vehicle_id)).fetchone():
            raise HTTPException(status_code=404, detail="Oil change not found")
        conn.execute(
            """UPDATE oil_changes SET date=?,odometer=?,oil_type=?,filter_brand=?,
               next_due_date=?,next_due_miles=?,notes=? WHERE id=?""",
            (o.date, o.odometer, o.oil_type, o.filter_brand,
             o.next_due_date, o.next_due_miles, o.notes, oil_id)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM oil_changes WHERE id=?", (oil_id,)).fetchone())
    finally:
        conn.close()

@router.delete("/{vehicle_id}/oil/{oil_id}", status_code=204)
def delete_oil_change(vehicle_id: int, oil_id: int):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM oil_changes WHERE id=? AND vehicle_id=?", (oil_id, vehicle_id)).fetchone():
            raise HTTPException(status_code=404, detail="Oil change not found")
        conn.execute("DELETE FROM oil_changes WHERE id=?", (oil_id,))
        conn.commit()
    finally:
        conn.close()


# ── tire routes ────────────────────────────────────────────────────────────
VALID_POSITIONS = {"FL", "FR", "RL", "RR", "spare", "staggered"}

@router.get("/{vehicle_id}/tires")
def list_tires(vehicle_id: int):
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT * FROM tires WHERE vehicle_id=? ORDER BY position ASC",
            (vehicle_id,)
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

@router.post("/{vehicle_id}/tires", status_code=201)
def add_tire(vehicle_id: int, t: TireCreate):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM vehicles WHERE id=?", (vehicle_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Vehicle not found")
        cur = conn.execute(
            """INSERT INTO tires
               (vehicle_id,position,brand,model,size,installed_date,installed_miles,
                tread_depth,rotation_interval_miles,next_rotation_miles,notes)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (vehicle_id, t.position, t.brand, t.model, t.size,
             t.installed_date, t.installed_miles, t.tread_depth,
             t.rotation_interval_miles, t.next_rotation_miles, t.notes)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM tires WHERE id=?", (cur.lastrowid,)).fetchone())
    finally:
        conn.close()

@router.patch("/{vehicle_id}/tires/{tire_id}")
def update_tire(vehicle_id: int, tire_id: int, t: TireUpdate):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM tires WHERE id=? AND vehicle_id=?", (tire_id, vehicle_id)).fetchone():
            raise HTTPException(status_code=404, detail="Tire not found")
        conn.execute(
            """UPDATE tires SET position=?,brand=?,model=?,size=?,installed_date=?,installed_miles=?,
               tread_depth=?,rotation_interval_miles=?,next_rotation_miles=?,notes=? WHERE id=?""",
            (t.position, t.brand, t.model, t.size, t.installed_date, t.installed_miles,
             t.tread_depth, t.rotation_interval_miles, t.next_rotation_miles, t.notes, tire_id)
        )
        conn.commit()
        return dict(conn.execute("SELECT * FROM tires WHERE id=?", (tire_id,)).fetchone())
    finally:
        conn.close()

@router.delete("/{vehicle_id}/tires/{tire_id}", status_code=204)
def delete_tire(vehicle_id: int, tire_id: int):
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM tires WHERE id=? AND vehicle_id=?", (tire_id, vehicle_id)).fetchone():
            raise HTTPException(status_code=404, detail="Tire not found")
        conn.execute("DELETE FROM tires WHERE id=?", (tire_id,))
        conn.commit()
    finally:
        conn.close()
