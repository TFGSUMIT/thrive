# =============================================================================
# routers/todo.py — To-Do module: a shared household task list
#
# A simple shared list: any signed-in identity (a person, or the kiosk Household)
# reads + writes the same household tasks. Own table; reuses the platform DB helper.
# (Per-person/private tasks can layer on later via owner_user_id + ownership_filter.)
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
import os, sqlite3

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/todo", tags=["todo"])


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
            CREATE TABLE IF NOT EXISTS todos (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                title      TEXT NOT NULL,
                done       INTEGER NOT NULL DEFAULT 0,
                created_at TEXT DEFAULT (datetime('now')),
                done_at    TEXT
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


class TodoIn(BaseModel):
    title: str

class TodoPatch(BaseModel):
    title: Optional[str] = None
    done:  Optional[bool] = None


@router.get("")
def list_todos(request: Request, db=Depends(get_db)):
    _auth(request)
    # open tasks first (done ASC), newest within each group
    return [dict(r) for r in db.execute(
        "SELECT id, title, done, created_at, done_at FROM todos ORDER BY done, id DESC"
    ).fetchall()]


@router.post("", status_code=201)
def add_todo(body: TodoIn, request: Request, db=Depends(get_db)):
    _auth(request)
    title = (body.title or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title required")
    cur = db.execute("INSERT INTO todos (title) VALUES (?)", (title,))
    db.commit()
    return {"id": cur.lastrowid, "title": title, "done": 0}


@router.patch("/{todo_id}")
def update_todo(todo_id: int, body: TodoPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM todos WHERE id=?", (todo_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.title is not None:
        t = body.title.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Title can't be empty")
        db.execute("UPDATE todos SET title=? WHERE id=?", (t, todo_id))
    if body.done is not None:
        d = 1 if body.done else 0
        db.execute("UPDATE todos SET done=?, done_at=CASE WHEN ?=1 THEN datetime('now') ELSE NULL END WHERE id=?",
                   (d, d, todo_id))
    db.commit()
    return {"ok": True}


@router.delete("/{todo_id}", status_code=204)
def delete_todo(todo_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM todos WHERE id=?", (todo_id,))
    db.commit()
