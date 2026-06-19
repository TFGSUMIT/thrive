# =============================================================================
# routers/accounts.py — Account management (login credentials)
# thrive (core)
#
# Accounts are login credentials (username/password/role). They are distinct
# from `users`, which are household profiles owned by the users module. Each
# account may link to one profile (accounts.user_id) so signing in drops you
# into that profile. Managed from Settings → Accounts (admin only).
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from routers.auth import get_db, hash_password, current_user_from_request

router = APIRouter(prefix="/accounts", tags=["accounts"])


# ── schemas ──────────────────────────────────────────────────────────────────
class CreateBody(BaseModel):
    username: str
    password: str
    email:    Optional[str] = None
    role:     Optional[str] = None
    user_id:  Optional[int] = None

class RoleBody(BaseModel):
    role: str

class PasswordBody(BaseModel):
    password: str

class DisabledBody(BaseModel):
    disabled: bool

class LinkBody(BaseModel):
    user_id: Optional[int] = None


# ── helpers ───────────────────────────────────────────────────────────────────
def _require_admin(request: Request) -> dict:
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    if user.get("role") != "admin": raise HTTPException(status_code=403, detail="Admin only")
    return user

def _active_admin_count(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM accounts WHERE role='admin' AND disabled=0").fetchone()["n"]

def _row(conn, account_id: int):
    return conn.execute(
        """SELECT a.id, a.username, a.email, a.role, a.disabled, a.user_id, a.created_at,
                  u.name AS user_name
           FROM accounts a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.id = ?""", (account_id,)
    ).fetchone()


# ── account management ────────────────────────────────────────────────────────
@router.get("")
def list_accounts(request: Request):
    _require_admin(request)
    conn = get_db()
    try:
        return [dict(r) for r in conn.execute(
            """SELECT a.id, a.username, a.email, a.role, a.disabled, a.user_id, a.created_at,
                      u.name AS user_name
               FROM accounts a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id"""
        ).fetchall()]
    finally:
        conn.close()

@router.post("", status_code=201)
def create_account(body: CreateBody, request: Request):
    _require_admin(request)
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    role = body.role if body.role in ("admin", "member") else "member"
    conn = get_db()
    try:
        if conn.execute("SELECT id FROM accounts WHERE username=?", (body.username,)).fetchone():
            raise HTTPException(status_code=409, detail="Username already taken")
        if body.user_id is not None and not conn.execute("SELECT id FROM users WHERE id=?", (body.user_id,)).fetchone():
            raise HTTPException(status_code=400, detail="Linked user not found")
        cur = conn.execute(
            "INSERT INTO accounts (username, email, password_hash, role, user_id) VALUES (?,?,?,?,?)",
            (body.username, body.email, hash_password(body.password), role, body.user_id)
        )
        conn.commit()
        return dict(_row(conn, cur.lastrowid))
    finally:
        conn.close()

@router.patch("/{account_id}/role")
def set_role(account_id: int, body: RoleBody, request: Request):
    _require_admin(request)
    if body.role not in ("admin", "member"): raise HTTPException(status_code=400, detail="Invalid role")
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="Account not found")
        if t["role"] == "admin" and body.role == "member" and _active_admin_count(conn) <= 1:
            raise HTTPException(status_code=400, detail="Can't remove the last admin")
        conn.execute("UPDATE accounts SET role=? WHERE id=?", (body.role, account_id)); conn.commit()
        return dict(_row(conn, account_id))
    finally:
        conn.close()

@router.patch("/{account_id}/disabled")
def set_disabled(account_id: int, body: DisabledBody, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="Account not found")
        if body.disabled and t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't disable yourself")
        if body.disabled and t["role"] == "admin" and _active_admin_count(conn) <= 1:
            raise HTTPException(status_code=400, detail="Can't disable the last admin")
        conn.execute("UPDATE accounts SET disabled=? WHERE id=?", (1 if body.disabled else 0, account_id))
        if body.disabled: conn.execute("DELETE FROM sessions WHERE account_id=?", (account_id,))
        conn.commit()
        return dict(_row(conn, account_id))
    finally:
        conn.close()

@router.patch("/{account_id}/password")
def reset_password(account_id: int, body: PasswordBody, request: Request):
    _require_admin(request)
    if len(body.password) < 8: raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM accounts WHERE id=?", (account_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Account not found")
        conn.execute("UPDATE accounts SET password_hash=? WHERE id=?", (hash_password(body.password), account_id))
        conn.execute("DELETE FROM sessions WHERE account_id=?", (account_id,))
        conn.commit()
        return {"ok": True}
    finally:
        conn.close()

@router.patch("/{account_id}/user")
def link_user(account_id: int, body: LinkBody, request: Request):
    """Link this account to a profile (or pass null to unlink)."""
    _require_admin(request)
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM accounts WHERE id=?", (account_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Account not found")
        if body.user_id is not None and not conn.execute("SELECT id FROM users WHERE id=?", (body.user_id,)).fetchone():
            raise HTTPException(status_code=400, detail="Linked user not found")
        conn.execute("UPDATE accounts SET user_id=? WHERE id=?", (body.user_id, account_id)); conn.commit()
        return dict(_row(conn, account_id))
    finally:
        conn.close()

@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, request: Request):
    actor = _require_admin(request)
    conn = get_db()
    try:
        t = conn.execute("SELECT * FROM accounts WHERE id=?", (account_id,)).fetchone()
        if not t: raise HTTPException(status_code=404, detail="Account not found")
        if t["id"] == actor["id"]: raise HTTPException(status_code=400, detail="Can't delete yourself")
        if t["role"] == "admin" and conn.execute("SELECT COUNT(*) AS n FROM accounts WHERE role='admin'").fetchone()["n"] <= 1:
            raise HTTPException(status_code=400, detail="Can't delete the last admin")
        conn.execute("DELETE FROM accounts WHERE id=?", (account_id,)); conn.commit()
    finally:
        conn.close()
