# =============================================================================
# routers/pantry.py — Pantry module: what's on hand in the fridge/freezer/pantry.
#
# A shared household stock list any signed-in identity can keep. Each item has a
# location, a quantity, and an optional use-by date. Own table; reuses the
# platform DB helper. The "send to groceries" tie is done on the frontend against
# the groceries module's own API (feature-detected), so this router stays
# self-contained and never reaches into another module's tables.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
import os, sqlite3

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/pantry", tags=["pantry"])

LOCATIONS = ("fridge", "freezer", "pantry")


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
            CREATE TABLE IF NOT EXISTS pantry_items (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                qty        REAL NOT NULL DEFAULT 1,
                unit       TEXT,
                location   TEXT NOT NULL DEFAULT 'pantry',
                expires_on TEXT,
                created_at TEXT DEFAULT (datetime('now'))
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


def _loc(v: Optional[str]) -> str:
    v = (v or "pantry").strip().lower()
    return v if v in LOCATIONS else "pantry"


class ItemIn(BaseModel):
    name: str
    qty: Optional[float] = 1
    unit: Optional[str] = None
    location: Optional[str] = "pantry"
    expires_on: Optional[str] = None

class ItemPatch(BaseModel):
    name: Optional[str] = None
    qty: Optional[float] = None
    unit: Optional[str] = None
    location: Optional[str] = None
    expires_on: Optional[str] = None


@router.get("")
def list_items(request: Request, db=Depends(get_db)):
    _auth(request)
    # group-friendly order: fridge, freezer, pantry (by created location order), then name
    return [dict(r) for r in db.execute(
        "SELECT id, name, qty, unit, location, expires_on, created_at FROM pantry_items "
        "ORDER BY CASE location WHEN 'fridge' THEN 0 WHEN 'freezer' THEN 1 ELSE 2 END, "
        "name COLLATE NOCASE"
    ).fetchall()]


@router.post("", status_code=201)
def add_item(body: ItemIn, request: Request, db=Depends(get_db)):
    _auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    qty = body.qty if body.qty is not None else 1
    if qty < 0:
        raise HTTPException(status_code=400, detail="Quantity can't be negative")
    unit = (body.unit or "").strip() or None
    expires = (body.expires_on or "").strip() or None
    cur = db.execute(
        "INSERT INTO pantry_items (name, qty, unit, location, expires_on) VALUES (?, ?, ?, ?, ?)",
        (name, qty, unit, _loc(body.location), expires),
    )
    db.commit()
    return dict(db.execute(
        "SELECT id, name, qty, unit, location, expires_on, created_at FROM pantry_items WHERE id=?",
        (cur.lastrowid,),
    ).fetchone())


@router.patch("/{item_id}")
def update_item(item_id: int, body: ItemPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM pantry_items WHERE id=?", (item_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        db.execute("UPDATE pantry_items SET name=? WHERE id=?", (n, item_id))
    if body.qty is not None:
        q = max(0, body.qty)
        db.execute("UPDATE pantry_items SET qty=? WHERE id=?", (q, item_id))
    if "unit" in body.model_fields_set:
        db.execute("UPDATE pantry_items SET unit=? WHERE id=?",
                   (((body.unit or "").strip() or None), item_id))
    if body.location is not None:
        db.execute("UPDATE pantry_items SET location=? WHERE id=?", (_loc(body.location), item_id))
    if "expires_on" in body.model_fields_set:
        db.execute("UPDATE pantry_items SET expires_on=? WHERE id=?",
                   (((body.expires_on or "").strip() or None), item_id))
    db.commit()
    return {"ok": True}


@router.delete("/{item_id}", status_code=204)
def delete_item(item_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM pantry_items WHERE id=?", (item_id,))
    db.commit()
