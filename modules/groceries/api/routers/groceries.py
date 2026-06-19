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
import os, sqlite3

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/groceries", tags=["groceries"])


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
        db.commit()
    finally:
        db.close()

init_db()


def _auth(request: Request):
    u = current_user_from_request(request)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


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
