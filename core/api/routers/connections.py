# =============================================================================
# routers/connections.py — per-profile external-service connections (Phase 2)
#
# A core, profile-scoped store for each person's external logins (Steam key, GOG
# creds, Google/MS OAuth, Plaid items, …). Secrets are encrypted at rest (see
# crypto.py). The owner only ever manages their OWN connections; the secret blob
# is write-only over the API (never returned by the list) — modules read the
# decrypted secret server-side via get_secret(). This generalizes what Calendar
# (OAuth) and Budget (Plaid/vault) currently hand-roll.
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import os, sqlite3, json

from routers.auth import get_db as _connect, current_profile_id
from crypto import encrypt, decrypt

router = APIRouter(prefix="/connections", tags=["connections"])


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
            CREATE TABLE IF NOT EXISTS connections (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                owner_user_id INTEGER NOT NULL,          -- the profile that owns it
                provider      TEXT NOT NULL,             -- e.g. 'steam', 'gog', 'google'
                label         TEXT,                      -- user-facing name
                secret        TEXT NOT NULL,             -- encrypted JSON credential blob
                created_at    TEXT DEFAULT (datetime('now')),
                updated_at    TEXT DEFAULT (datetime('now'))
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


# ── module-facing helper: decrypted secret for a (profile, provider) ──────────
def get_secret(db, profile_id: int, provider: str) -> Optional[dict]:
    """The decrypted secret dict for one profile's connection to `provider`, or
    None. Modules call this server-side; the secret never crosses the API."""
    row = db.execute(
        "SELECT secret FROM connections WHERE owner_user_id = ? AND provider = ? ORDER BY id LIMIT 1",
        (profile_id, provider)
    ).fetchone()
    return json.loads(decrypt(row["secret"])) if row else None


class ConnIn(BaseModel):
    provider: str
    label: Optional[str] = None
    secret: dict                       # arbitrary credential blob → stored encrypted


class ConnUpdate(BaseModel):
    label: Optional[str] = None
    secret: Optional[dict] = None


def _me(request: Request) -> int:
    me = current_profile_id(request)
    if me is None:
        raise HTTPException(status_code=400, detail="Sign in with a profile to manage connections")
    return me


@router.get("/")
def list_connections(request: Request, provider: Optional[str] = None, db=Depends(get_db)):
    """The signed-in profile's connections — metadata only, never the secret."""
    me = _me(request)
    q = "SELECT id, provider, label, created_at, updated_at FROM connections WHERE owner_user_id = ?"
    params = [me]
    if provider:
        q += " AND provider = ?"; params.append(provider)
    rows = db.execute(q + " ORDER BY provider, id", params).fetchall()
    return [dict(r) for r in rows]


@router.post("/", status_code=201)
def add_connection(body: ConnIn, request: Request, db=Depends(get_db)):
    me = _me(request)
    cur = db.execute(
        "INSERT INTO connections (owner_user_id, provider, label, secret) VALUES (?, ?, ?, ?)",
        (me, body.provider, body.label, encrypt(json.dumps(body.secret)))
    )
    db.commit()
    return {"id": cur.lastrowid, "provider": body.provider, "label": body.label}


@router.patch("/{conn_id}")
def update_connection(conn_id: int, body: ConnUpdate, request: Request, db=Depends(get_db)):
    me = _me(request)
    row = db.execute(
        "SELECT id, label, secret FROM connections WHERE id = ? AND owner_user_id = ?",
        (conn_id, me)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    new_label  = body.label if body.label is not None else row["label"]
    new_secret = encrypt(json.dumps(body.secret)) if body.secret is not None else row["secret"]
    db.execute(
        "UPDATE connections SET label = ?, secret = ?, updated_at = datetime('now') WHERE id = ?",
        (new_label, new_secret, conn_id)
    )
    db.commit()
    return {"id": conn_id, "label": new_label}


@router.delete("/{conn_id}", status_code=204)
def delete_connection(conn_id: int, request: Request, db=Depends(get_db)):
    me = _me(request)
    row = db.execute(
        "SELECT id FROM connections WHERE id = ? AND owner_user_id = ?", (conn_id, me)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    db.execute("DELETE FROM connections WHERE id = ?", (conn_id,))
    db.commit()
