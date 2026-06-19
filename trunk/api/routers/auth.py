# =============================================================================
# routers/auth.py — Platform auth (users, sessions, roles)
# thrive
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Response
from pydantic import BaseModel
from typing import Optional
import sqlite3, os, hashlib, secrets, hmac, json
from datetime import datetime, timedelta

router = APIRouter(prefix="/auth", tags=["auth"])

DB_PATH       = os.environ.get("DB_FILE", "/data/thrive.db")
COOKIE_NAME   = "thrive_session"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "true").lower() != "false"
SESSION_DAYS  = int(os.environ.get("SESSION_DAYS", "30"))
PBKDF2_ITERS  = 200_000

PUBLIC_PATHS = {"/health", "/auth/status", "/auth/login", "/auth/logout", "/auth/register"}


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

def _table_cols(conn, table: str) -> list[str]:
    return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]

def _migrate_legacy_split(conn):
    """One-time split of the old single `users` (credentials+identity) table into
    `accounts` (credentials) + `users` (profiles). Runs only when the legacy schema
    is detected: a `users` table with a `password_hash` column and no `accounts` yet."""
    tables = {r["name"] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    legacy = "users" in tables and "accounts" not in tables and \
             "password_hash" in _table_cols(conn, "users")
    if not legacy:
        return
    print("[auth] migrating legacy users table → accounts + profiles")
    # 1. credentials table takes the new name
    conn.execute("ALTER TABLE users RENAME TO accounts")
    # 2. fresh profiles table
    conn.execute("""
        CREATE TABLE users (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            name       TEXT NOT NULL,
            avatar     TEXT,
            color      TEXT,
            created_at TEXT DEFAULT (datetime('now'))
        )
    """)
    # 3. link column on accounts
    conn.execute("ALTER TABLE accounts ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL")
    # 4. give every existing account a profile built from its username, and link it
    for acct in conn.execute("SELECT id, username FROM accounts").fetchall():
        cur = conn.execute("INSERT INTO users (name) VALUES (?)", (acct["username"],))
        conn.execute("UPDATE accounts SET user_id=? WHERE id=?", (cur.lastrowid, acct["id"]))
    # 5. sessions are ephemeral — rebuild on account_id (everyone re-logs in once)
    conn.execute("DROP TABLE IF EXISTS sessions")
    conn.commit()

def init_db():
    conn = get_db()
    try:
        # legacy split must happen before the CREATE IF NOT EXISTS below, otherwise
        # the old credential `users` table would be mistaken for the profiles table.
        _migrate_legacy_split(conn)
        # accounts = login credentials (was `users`)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS accounts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                username      TEXT UNIQUE NOT NULL,
                email         TEXT,
                password_hash TEXT NOT NULL,
                role          TEXT DEFAULT 'member',
                totp_secret   TEXT,
                disabled      INTEGER DEFAULT 0,
                user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at    TEXT DEFAULT (datetime('now'))
            )
        """)
        # users = household profiles/people (a person, not a login)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                avatar     TEXT,
                color      TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                token      TEXT PRIMARY KEY,
                account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
                created_at TEXT DEFAULT (datetime('now')),
                expires_at TEXT NOT NULL
            )
        """)
        # per-user UI preferences (theme, …) — a JSON blob on the account so they
        # follow the login across devices. Idempotent add for existing DBs.
        acct_cols = [c["name"] for c in conn.execute("PRAGMA table_info(accounts)").fetchall()]
        if "prefs" not in acct_cols:
            conn.execute("ALTER TABLE accounts ADD COLUMN prefs TEXT DEFAULT '{}'")
        conn.commit()
    finally:
        conn.close()

init_db()


# ── password + session ───────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk   = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERS)
    return f"pbkdf2_sha256${PBKDF2_ITERS}${salt.hex()}${dk.hex()}"

def verify_password(password: str, stored: str) -> bool:
    try:
        _, iters, salt_hex, dk_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), int(iters))
        return hmac.compare_digest(dk.hex(), dk_hex)
    except Exception:
        return False

def create_session(conn, account_id: int) -> str:
    token   = secrets.token_urlsafe(32)
    expires = (datetime.utcnow() + timedelta(days=SESSION_DAYS)).isoformat()
    conn.execute("INSERT INTO sessions (token, account_id, expires_at) VALUES (?,?,?)", (token, account_id, expires))
    return token

def _account_payload(row) -> dict:
    """Shape the authenticated identity for the frontend: top-level account fields
    (back-compat) plus the linked profile, if any."""
    profile = None
    if row["profile_id"] is not None:
        profile = {"id": row["profile_id"], "name": row["profile_name"],
                   "avatar": row["profile_avatar"], "color": row["profile_color"]}
    try:
        prefs = json.loads(row["prefs"]) if row["prefs"] else {}
    except Exception:
        prefs = {}
    return {"id": row["id"], "username": row["username"], "email": row["email"],
            "role": row["role"], "profile": profile, "prefs": prefs}

def user_from_token(token: Optional[str]) -> Optional[dict]:
    if not token: return None
    conn = get_db()
    try:
        row = conn.execute(
            """SELECT s.expires_at, a.id, a.username, a.email, a.role, a.disabled, a.prefs,
                      u.id AS profile_id, u.name AS profile_name,
                      u.avatar AS profile_avatar, u.color AS profile_color
               FROM sessions s JOIN accounts a ON a.id = s.account_id
               LEFT JOIN users u ON u.id = a.user_id WHERE s.token = ?""",
            (token,)
        ).fetchone()
        if not row or row["disabled"]: return None
        if row["expires_at"] < datetime.utcnow().isoformat():
            conn.execute("DELETE FROM sessions WHERE token=?", (token,)); conn.commit(); return None
        return _account_payload(row)
    finally:
        conn.close()

def current_user_from_request(request: Request) -> Optional[dict]:
    return user_from_token(request.cookies.get(COOKIE_NAME))


# ── personal ownership (Phase 1 of the personal-data platform) ────────────────
# Reusable scoping primitive. A module table that can be personal carries a
# nullable `owner_user_id` (NULL = household/shared, set = personal to a profile).
# A module router resolves "me" with current_profile_id() and builds a WHERE
# clause with ownership_filter(). Default scope is 'all' (household + mine).
# Guardianship (seeing a dependent's rows) layers on later by widening the id set.
def current_profile_id(request: Request) -> Optional[int]:
    """The logged-in account's linked profile id, or None (no profile → can only
    see household/shared rows)."""
    u = current_user_from_request(request)
    if not u:
        return None
    p = u.get("profile")
    return p["id"] if p else None

def ownership_filter(profile_id: Optional[int], scope: str = "all",
                     column: str = "owner_user_id") -> tuple[str, list]:
    """(sql_fragment, params) to scope a query by personal ownership:
         household → shared rows only (owner IS NULL)
         mine      → my personal rows only
         all       → shared + mine (default)
    A profile-less viewer (profile_id is None) only ever sees household rows."""
    if scope == "household" or profile_id is None:
        return (f"{column} IS NULL", [])
    if scope == "mine":
        return (f"{column} = ?", [profile_id])
    return (f"({column} IS NULL OR {column} = ?)", [profile_id])   # 'all'

def visible_owned_ids(db, table: str, profile_id: Optional[int], scope: str = "all",
                      id_col: str = "id", owner_col: str = "owner_user_id") -> list:
    """Ids of rows in `table` the viewer may see — for use as an `IN (...)` filter
    on related tables (e.g. transactions of the budget accounts you can see), so
    personal rows' children stay private too. `table`/columns are caller-supplied
    constants; never pass user input."""
    own_sql, own_params = ownership_filter(profile_id, scope, column=owner_col)
    return [r[0] for r in db.execute(f"SELECT {id_col} FROM {table} WHERE {own_sql}", own_params).fetchall()]

def _set_cookie(response: Response, token: str):
    response.set_cookie(key=COOKIE_NAME, value=token, max_age=SESSION_DAYS * 86400,
                        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/")


# ── schemas ──────────────────────────────────────────────────────────────────
class RegisterBody(BaseModel):
    username: str
    password: str
    email:    Optional[str] = None
    role:     Optional[str] = None

class LoginBody(BaseModel):
    username: str
    password: str

# ── helpers ───────────────────────────────────────────────────────────────────
def _count_accounts(conn) -> int:
    return conn.execute("SELECT COUNT(*) AS n FROM accounts").fetchone()["n"]


# ── public routes ─────────────────────────────────────────────────────────────
@router.get("/status")
def status():
    conn = get_db()
    try: return {"setup_needed": _count_accounts(conn) == 0}
    finally: conn.close()

@router.post("/register", status_code=201)
def register(body: RegisterBody, response: Response):
    """First-run owner bootstrap only. Creates the first admin account plus a
    matching profile and links them. Once an account exists this returns 403 —
    additional accounts are created in Settings, profiles in the users module."""
    if not body.username or not body.password:
        raise HTTPException(status_code=400, detail="Username and password required")
    if len(body.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    conn = get_db()
    try:
        if _count_accounts(conn) != 0:
            raise HTTPException(status_code=403, detail="Registration is closed — add accounts in Settings")
        profile = conn.execute("INSERT INTO users (name) VALUES (?)", (body.username,))
        acct = conn.execute(
            "INSERT INTO accounts (username, email, password_hash, role, user_id) VALUES (?,?,?,'admin',?)",
            (body.username, body.email, hash_password(body.password), profile.lastrowid)
        )
        conn.commit()
        token = create_session(conn, acct.lastrowid); conn.commit()
        _set_cookie(response, token)
        return user_from_token(token)
    finally:
        conn.close()

@router.post("/login")
def login(body: LoginBody, response: Response):
    conn = get_db()
    try:
        row    = conn.execute("SELECT * FROM accounts WHERE username=?", (body.username,)).fetchone()
        stored = row["password_hash"] if row else "pbkdf2_sha256$1$00$00"
        ok     = verify_password(body.password, stored)
        if not row or not ok or row["disabled"]:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        token = create_session(conn, row["id"]); conn.commit()
        _set_cookie(response, token)
        return user_from_token(token)
    finally:
        conn.close()

@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE_NAME)
    if token:
        conn = get_db()
        try: conn.execute("DELETE FROM sessions WHERE token=?", (token,)); conn.commit()
        finally: conn.close()
    response.delete_cookie(COOKIE_NAME, path="/")
    return {"ok": True}

@router.get("/me")
def me(request: Request):
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@router.patch("/me/prefs")
def update_my_prefs(body: dict, request: Request):
    """Self-serve: any logged-in account updates ITS OWN UI prefs (theme, …).
    Shallow-merges the patch into the stored prefs JSON; a null value drops a key.
    Distinct from admin-only /accounts/{id}."""
    user = current_user_from_request(request)
    if not user: raise HTTPException(status_code=401, detail="Not authenticated")
    conn = get_db()
    try:
        row = conn.execute("SELECT prefs FROM accounts WHERE id=?", (user["id"],)).fetchone()
        try:
            prefs = json.loads(row["prefs"]) if row and row["prefs"] else {}
        except Exception:
            prefs = {}
        for k, v in (body or {}).items():
            if v is None: prefs.pop(k, None)
            else:         prefs[k] = v
        conn.execute("UPDATE accounts SET prefs=? WHERE id=?", (json.dumps(prefs), user["id"]))
        conn.commit()
        return {"prefs": prefs}
    finally:
        conn.close()