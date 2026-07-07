# =============================================================================
# routers/groceries.py — Groceries module: a shared household shopping list
#
# A shared list any signed-in identity (a person, or the kiosk Household) can add
# to and check off. "Got" items can be swept in one tap after a shop. Own table;
# reuses the platform DB helper.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
import os, sqlite3, json, urllib.parse, urllib.request, urllib.error

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/groceries", tags=["groceries"])

# Open Food Facts — on-demand product lookup. OFF asks that every caller send a
# descriptive User-Agent, and holds to a "1 real scan = 1 call" courtesy rule,
# which the product_cache below honours (repeat barcodes never re-hit the API).
OFF_UA = "thrive-groceries/0.1 (github.com/nerfarrow/thrive)"
OFF_FIELDS = "code,product_name,brands,categories,image_small_url"
OFF_TIMEOUT = 8


def get_db():
    db = sqlite3.connect(os.environ.get("DB_FILE", "/data/thrive.db"), check_same_thread=False)
    db.row_factory = sqlite3.Row
    try:
        yield db
    finally:
        db.close()


def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS groceries (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                got        INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # Local Open Food Facts cache — one row per barcode seen. found=0 is a
        # tombstone so known-misses don't re-hit the API either.
        db.execute("""
            CREATE TABLE IF NOT EXISTS product_cache (
                barcode    TEXT PRIMARY KEY,
                found      INTEGER NOT NULL DEFAULT 0,
                name       TEXT,
                brand      TEXT,
                category   TEXT,
                image      TEXT,
                fetched_at TEXT DEFAULT (datetime('now'))
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


def _auth(request: Request):
    u = current_user_from_request(request)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


# -- Open Food Facts helpers --------------------------------------------------
def _digits(s: str) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


def _short_category(categories: str) -> Optional[str]:
    """OFF `categories` is a comma list, broad→specific; keep the most specific."""
    if not categories:
        return None
    parts = [p.strip() for p in categories.split(",") if p.strip()]
    return parts[-1] if parts else None


def _text(v) -> Optional[str]:
    """Coerce an OFF field to a trimmed string. The v2 product API returns
    `brands` as a comma-string, but the search service returns it as a list —
    normalise both (and drop empties to None)."""
    if isinstance(v, list):
        v = ", ".join(str(x).strip() for x in v if x)
    return (v.strip() if isinstance(v, str) else "") or None


def _shape(p: dict) -> dict:
    """OFF product JSON → our 4 fields (+ barcode)."""
    return {
        "barcode":  _text(p.get("code")) or "",
        "name":     _text(p.get("product_name")),
        "brand":    _text(p.get("brands")),
        "category": _short_category(_text(p.get("categories")) or ""),
        "image":    _text(p.get("image_small_url")) or _text(p.get("image_url")),
    }


def _off_get(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": OFF_UA})
    try:
        with urllib.request.urlopen(req, timeout=OFF_TIMEOUT) as r:
            return json.load(r)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"Open Food Facts unreachable: {e}")


class ItemIn(BaseModel):
    name: str

class ItemPatch(BaseModel):
    name: Optional[str] = None
    got:  Optional[bool] = None


@router.get("")
def list_items(request: Request, db=Depends(get_db)):
    _auth(request)
    # still-needed first (got ASC), newest within each group
    return [dict(r) for r in db.execute(
        "SELECT id, name, got, created_at FROM groceries ORDER BY got, id DESC"
    ).fetchall()]


@router.post("", status_code=201)
def add_item(body: ItemIn, request: Request, db=Depends(get_db)):
    _auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    cur = db.execute("INSERT INTO groceries (name) VALUES (?)", (name,))
    db.commit()
    return {"id": cur.lastrowid, "name": name, "got": 0}


@router.patch("/{item_id}")
def update_item(item_id: int, body: ItemPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM groceries WHERE id=?", (item_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        db.execute("UPDATE groceries SET name=? WHERE id=?", (n, item_id))
    if body.got is not None:
        db.execute("UPDATE groceries SET got=? WHERE id=?", (1 if body.got else 0, item_id))
    db.commit()
    return {"ok": True}


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM groceries WHERE id=?", (item_id,))
    db.commit()


@router.post("/clear-got")
def clear_got(request: Request, db=Depends(get_db)):
    """Sweep all checked-off items (e.g. after a shop)."""
    _auth(request)
    n = db.execute("DELETE FROM groceries WHERE got=1").rowcount
    db.commit()
    return {"cleared": n}


def _cache_put(db, item: dict, found: int):
    db.execute(
        "INSERT INTO product_cache (barcode, found, name, brand, category, image, fetched_at) "
        "VALUES (?, ?, ?, ?, ?, ?, datetime('now')) "
        "ON CONFLICT(barcode) DO UPDATE SET "
        "found=excluded.found, name=excluded.name, brand=excluded.brand, "
        "category=excluded.category, image=excluded.image, fetched_at=excluded.fetched_at",
        (item.get("barcode"), found, item.get("name"), item.get("brand"),
         item.get("category"), item.get("image")),
    )


@router.get("/lookup/{barcode}")
def lookup_barcode(barcode: str, request: Request, db=Depends(get_db)):
    """Resolve a barcode to a product — local cache first, then OFF (and cache it)."""
    _auth(request)
    code = _digits(barcode)
    if not (8 <= len(code) <= 14):
        raise HTTPException(status_code=400, detail="Not a valid barcode")

    cached = db.execute(
        "SELECT found, name, brand, category, image FROM product_cache WHERE barcode=?",
        (code,),
    ).fetchone()
    if cached is not None:
        if not cached["found"]:
            return {"found": False, "barcode": code, "source": "cache"}
        return {"found": True, "source": "cache", "barcode": code,
                **{k: cached[k] for k in ("name", "brand", "category", "image")}}

    data = _off_get(f"https://world.openfoodfacts.org/api/v2/product/{urllib.parse.quote(code)}?fields={OFF_FIELDS}")
    if data.get("status") == 1 and data.get("product"):
        item = _shape(data["product"])
        item["barcode"] = code
        _cache_put(db, item, 1 if item["name"] else 0); db.commit()
        if item["name"]:
            return {"found": True, "source": "off", **item}
    else:
        _cache_put(db, {"barcode": code}, 0); db.commit()
    return {"found": False, "barcode": code, "source": "off"}


@router.get("/search")
def search_products(request: Request, q: str, db=Depends(get_db)):
    """Name search against OFF's search service (the legacy cgi/search.pl is
    perpetually 503); cache each hit's barcode for instant re-lookup."""
    _auth(request)
    term = (q or "").strip()
    if len(term) < 2:
        return {"results": []}
    url = ("https://search.openfoodfacts.org/search?"
           + urllib.parse.urlencode({"q": term, "page_size": 10, "fields": OFF_FIELDS}))
    data = _off_get(url)
    results = []
    for p in (data.get("hits") or []):
        item = _shape(p)
        if not item["name"]:
            continue
        if item["barcode"]:
            _cache_put(db, item, 1)
        results.append(item)
    db.commit()
    return {"results": results}
