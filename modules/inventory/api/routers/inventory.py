# =============================================================================
# routers/inventory.py — Inventory module: a home inventory of what you own.
#
# A household record of possessions for insurance / warranty tracking: each item
# has a room, category, value, serial, purchase + warranty dates, and notes.
# Money is stored as INTEGER cents (platform convention); dates are TEXT ISO.
# Own table; reuses the platform DB helper.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
import os, sqlite3

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/inventory", tags=["inventory"])

FIELDS = "id, name, category, location, serial, purchase_date, price_cents, warranty_until, notes"


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
            CREATE TABLE IF NOT EXISTS inventory_items (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                name           TEXT NOT NULL,
                category       TEXT,
                location       TEXT,
                serial         TEXT,
                purchase_date  TEXT,
                price_cents    INTEGER,
                warranty_until TEXT,
                notes          TEXT,
                created_at     TEXT DEFAULT (datetime('now'))
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


def _clean(v: Optional[str]) -> Optional[str]:
    return (v.strip() or None) if isinstance(v, str) else None


class ItemIn(BaseModel):
    name: str
    category: Optional[str] = None
    location: Optional[str] = None
    serial: Optional[str] = None
    purchase_date: Optional[str] = None
    price_cents: Optional[int] = None
    warranty_until: Optional[str] = None
    notes: Optional[str] = None

class ItemPatch(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    location: Optional[str] = None
    serial: Optional[str] = None
    purchase_date: Optional[str] = None
    price_cents: Optional[int] = None
    warranty_until: Optional[str] = None
    notes: Optional[str] = None


@router.get("")
def list_items(request: Request, db=Depends(get_db)):
    _auth(request)
    items = [dict(r) for r in db.execute(
        f"SELECT {FIELDS} FROM inventory_items "
        "ORDER BY (location IS NULL), location COLLATE NOCASE, name COLLATE NOCASE"
    ).fetchall()]
    total = db.execute("SELECT COALESCE(SUM(price_cents), 0) FROM inventory_items").fetchone()[0]
    return {"items": items, "total_cents": total, "count": len(items)}


@router.post("", status_code=201)
def add_item(body: ItemIn, request: Request, db=Depends(get_db)):
    _auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if body.price_cents is not None and body.price_cents < 0:
        raise HTTPException(status_code=400, detail="Price can't be negative")
    cur = db.execute(
        "INSERT INTO inventory_items (name, category, location, serial, purchase_date, price_cents, warranty_until, notes) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (name, _clean(body.category), _clean(body.location), _clean(body.serial),
         _clean(body.purchase_date), body.price_cents, _clean(body.warranty_until), _clean(body.notes)),
    )
    db.commit()
    return dict(db.execute(f"SELECT {FIELDS} FROM inventory_items WHERE id=?", (cur.lastrowid,)).fetchone())


@router.patch("/{item_id}")
def update_item(item_id: int, body: ItemPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM inventory_items WHERE id=?", (item_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        db.execute("UPDATE inventory_items SET name=? WHERE id=?", (n, item_id))
    if body.price_cents is not None:
        if body.price_cents < 0:
            raise HTTPException(status_code=400, detail="Price can't be negative")
        db.execute("UPDATE inventory_items SET price_cents=? WHERE id=?", (body.price_cents, item_id))
    # nullable text fields: honor an explicit send (including clearing to null)
    for f in ("category", "location", "serial", "purchase_date", "warranty_until", "notes"):
        if f in body.model_fields_set:
            db.execute(f"UPDATE inventory_items SET {f}=? WHERE id=?", (_clean(getattr(body, f)), item_id))
    db.commit()
    return {"ok": True}


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM inventory_items WHERE id=?", (item_id,))
    db.commit()
