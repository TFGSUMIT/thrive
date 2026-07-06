# =============================================================================
# routers/links.py — Links module: a native bookmarks / app-launcher dashboard.
#
# A thrive-native replacement for the standalone flame container: categorized
# link tiles any signed-in identity can add/edit. Own tables (link_categories,
# links); reuses the platform DB helper. No sidecar, no nginx touch.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
import os, sqlite3

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/links", tags=["links"])


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
            CREATE TABLE IF NOT EXISTS link_categories (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                sort       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS links (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                title       TEXT NOT NULL,
                url         TEXT NOT NULL,
                icon        TEXT,
                category_id INTEGER REFERENCES link_categories(id) ON DELETE SET NULL,
                sort        INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT DEFAULT (datetime('now'))
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


def _norm_url(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return u
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u


# -- schemas ------------------------------------------------------------------
class CategoryIn(BaseModel):
    name: str

class CategoryPatch(BaseModel):
    name: Optional[str] = None
    sort: Optional[int] = None

class LinkIn(BaseModel):
    title: str
    url: str
    icon: Optional[str] = None
    category_id: Optional[int] = None

class LinkPatch(BaseModel):
    title: Optional[str] = None
    url: Optional[str] = None
    icon: Optional[str] = None
    category_id: Optional[int] = None
    sort: Optional[int] = None


# -- read ---------------------------------------------------------------------
@router.get("")
def list_all(request: Request, db=Depends(get_db)):
    """Everything the dashboard needs: ordered categories + ordered links."""
    _auth(request)
    cats = [dict(r) for r in db.execute(
        "SELECT id, name, sort FROM link_categories ORDER BY sort, name"
    ).fetchall()]
    links = [dict(r) for r in db.execute(
        "SELECT id, title, url, icon, category_id, sort FROM links ORDER BY sort, title"
    ).fetchall()]
    return {"categories": cats, "links": links}


# -- categories ---------------------------------------------------------------
@router.post("/categories", status_code=201)
def add_category(body: CategoryIn, request: Request, db=Depends(get_db)):
    _auth(request)
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    nxt = db.execute("SELECT COALESCE(MAX(sort), -1) + 1 FROM link_categories").fetchone()[0]
    cur = db.execute("INSERT INTO link_categories (name, sort) VALUES (?, ?)", (name, nxt))
    db.commit()
    return {"id": cur.lastrowid, "name": name, "sort": nxt}


@router.patch("/categories/{cat_id}")
def update_category(cat_id: int, body: CategoryPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM link_categories WHERE id=?", (cat_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        db.execute("UPDATE link_categories SET name=? WHERE id=?", (n, cat_id))
    if body.sort is not None:
        db.execute("UPDATE link_categories SET sort=? WHERE id=?", (body.sort, cat_id))
    db.commit()
    return {"ok": True}


@router.delete("/categories/{cat_id}", status_code=204)
def delete_category(cat_id: int, request: Request, db=Depends(get_db)):
    """Delete a category; its links survive, dropped to Uncategorized."""
    _auth(request)
    db.execute("UPDATE links SET category_id=NULL WHERE category_id=?", (cat_id,))
    db.execute("DELETE FROM link_categories WHERE id=?", (cat_id,))
    db.commit()


# -- links --------------------------------------------------------------------
@router.post("", status_code=201)
def add_link(body: LinkIn, request: Request, db=Depends(get_db)):
    _auth(request)
    title = (body.title or "").strip()
    url = _norm_url(body.url)
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    if not url:
        raise HTTPException(status_code=400, detail="URL required")
    cat_id = body.category_id
    if cat_id is not None and not db.execute(
        "SELECT id FROM link_categories WHERE id=?", (cat_id,)
    ).fetchone():
        raise HTTPException(status_code=400, detail="Unknown category")
    icon = (body.icon or "").strip() or None
    nxt = db.execute(
        "SELECT COALESCE(MAX(sort), -1) + 1 FROM links WHERE category_id IS ?", (cat_id,)
    ).fetchone()[0]
    cur = db.execute(
        "INSERT INTO links (title, url, icon, category_id, sort) VALUES (?, ?, ?, ?, ?)",
        (title, url, icon, cat_id, nxt),
    )
    db.commit()
    return {"id": cur.lastrowid, "title": title, "url": url, "icon": icon,
            "category_id": cat_id, "sort": nxt}


@router.patch("/{link_id}")
def update_link(link_id: int, body: LinkPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM links WHERE id=?", (link_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Title can't be empty")
        db.execute("UPDATE links SET title=? WHERE id=?", (t, link_id))
    if body.url is not None:
        u = _norm_url(body.url)
        if not u:
            raise HTTPException(status_code=400, detail="URL can't be empty")
        db.execute("UPDATE links SET url=? WHERE id=?", (u, link_id))
    if body.icon is not None:
        db.execute("UPDATE links SET icon=? WHERE id=?", ((body.icon.strip() or None), link_id))
    if body.category_id is not None or "category_id" in body.model_fields_set:
        cid = body.category_id
        if cid is not None and not db.execute(
            "SELECT id FROM link_categories WHERE id=?", (cid,)
        ).fetchone():
            raise HTTPException(status_code=400, detail="Unknown category")
        db.execute("UPDATE links SET category_id=? WHERE id=?", (cid, link_id))
    if body.sort is not None:
        db.execute("UPDATE links SET sort=? WHERE id=?", (body.sort, link_id))
    db.commit()
    return {"ok": True}


@router.delete("/{link_id}", status_code=204)
def delete_link(link_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM links WHERE id=?", (link_id,))
    db.commit()
