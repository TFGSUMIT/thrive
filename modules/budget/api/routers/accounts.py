# =============================================================================
# routers/accounts.py — Budget module: financial accounts (checking/credit/…)
# thrive module `budget`
#
# NOTE: namespaced as `budget_accounts` (table) and `/budget/accounts` (route)
# to avoid colliding with the core auth `accounts` table (login credentials).
#
# Personal-data platform (P1): a `budget_accounts` row may be HOUSEHOLD
# (owner_user_id IS NULL, everyone sees it) or PERSONAL (owner_user_id = a
# profile, visible ONLY to that profile). Visibility is enforced server-side via
# ownership_filter() on every read, so a personal account can't be listed,
# fetched, balanced, edited, or deleted by anyone but its owner.
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import BaseModel
from typing import Optional
import sqlite3

from routers.auth import get_db as _connect, current_profile_id, ownership_filter

import os, sqlite3

router = APIRouter(prefix="/budget/accounts", tags=["budget-accounts"])


# ── db + money helpers ───────────────────────────────────────────────────────
def get_db():
    db = sqlite3.connect(os.environ.get("DB_FILE", "/data/thrive.db"), check_same_thread=False)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    try:
        yield db
    finally:
        db.close()

def to_cents(dollars: float) -> int:
    return int(round(float(dollars) * 100))

def from_cents(cents: int) -> float:
    return round((cents or 0) / 100, 2)

def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS budget_accounts (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                name          TEXT NOT NULL UNIQUE,
                institution   TEXT,
                number        TEXT,
                on_budget     INTEGER NOT NULL DEFAULT 1,
                vault_item_id TEXT
            )
        """)
        # manual drag-to-reorder position. Backfill once in the previous default
        # display order (on-budget first, then name) so nothing visibly shifts.
        cols = [r[1] for r in db.execute("PRAGMA table_info(budget_accounts)").fetchall()]
        if "position" not in cols:
            db.execute("ALTER TABLE budget_accounts ADD COLUMN position INTEGER")
            rows = db.execute("SELECT id FROM budget_accounts ORDER BY on_budget DESC, name").fetchall()
            for i, r in enumerate(rows):
                db.execute("UPDATE budget_accounts SET position = ? WHERE id = ?", (i, r[0]))
        # personal ownership: NULL = household (shared), set = personal to a profile
        if "owner_user_id" not in cols:
            db.execute("ALTER TABLE budget_accounts ADD COLUMN owner_user_id INTEGER")
        db.commit()
    finally:
        db.close()

init_db()


# ── visible-account helper (shared with transactions/reports for full privacy) ─
def visible_account_ids(db, profile_id: Optional[int], scope: str = "all") -> list[int]:
    """Account ids the given viewer is allowed to see, for the given scope.
    Other budget routers use this to keep personal accounts' transactions and
    report totals private too."""
    own_sql, own_params = ownership_filter(profile_id, scope, column="owner_user_id")
    rows = db.execute(f"SELECT id FROM budget_accounts WHERE {own_sql}", own_params).fetchall()
    return [r[0] for r in rows]


class AccountIn(BaseModel):
    name: str
    institution: Optional[str] = None
    number: Optional[str] = None
    on_budget: Optional[bool] = True
    personal: Optional[bool] = False        # True → visible only to the creating profile


class AccountUpdate(BaseModel):
    name: Optional[str] = None
    institution: Optional[str] = None
    number: Optional[str] = None
    on_budget: Optional[bool] = None
    vault_item_id: Optional[str] = None
    personal: Optional[bool] = None         # toggle personal/household (owner only)


@router.get("/")
def list_accounts(request: Request, scope: str = Query("all"), db=Depends(get_db)):
    me = current_profile_id(request)
    own_sql, own_params = ownership_filter(me, scope, column="a.owner_user_id")
    rows = db.execute(f"""
        SELECT a.id, a.name, a.institution, a.number, a.on_budget, a.vault_item_id, a.position,
               a.owner_user_id,
               COALESCE((
                   SELECT SUM(amount_cents) FROM transactions
                   WHERE account_id = a.id
                   AND (cleared IS NULL OR cleared != 'Unverified')
               ), 0) as balance_cents,
               (SELECT COUNT(*) FROM scheduled    WHERE account_id = a.id) as scheduled_count,
               (SELECT COUNT(*) FROM transactions WHERE account_id = a.id) as transactions_count
        FROM budget_accounts a
        WHERE {own_sql}
        ORDER BY a.position IS NULL, a.position, a.on_budget DESC, a.name
    """, own_params).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["balance"]   = from_cents(d.pop("balance_cents"))
        d["on_budget"] = bool(d["on_budget"])
        d["personal"]  = d.pop("owner_user_id") is not None
        result.append(d)
    return result


class ReorderIn(BaseModel):
    order: list[int]


@router.put("/reorder")
def reorder_accounts(body: ReorderIn, request: Request, db=Depends(get_db)):
    """Persist a new manual ordering. `order` is account ids, top-to-bottom.
    Only accounts the caller can see are repositioned."""
    me = current_profile_id(request)
    visible = set(visible_account_ids(db, me, "all"))
    for i, account_id in enumerate(body.order):
        if account_id in visible:
            db.execute("UPDATE budget_accounts SET position = ? WHERE id = ?", (i, account_id))
    db.commit()
    return {"ok": True, "count": len(body.order)}


@router.get("/{account_id}")
def get_account(account_id: int, request: Request, db=Depends(get_db)):
    me = current_profile_id(request)
    own_sql, own_params = ownership_filter(me, "all", column="owner_user_id")
    row = db.execute(
        f"SELECT id, name, institution, number, on_budget, vault_item_id, owner_user_id "
        f"FROM budget_accounts WHERE id = ? AND {own_sql}",
        (account_id, *own_params)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    d = dict(row)
    d["on_budget"] = bool(d["on_budget"])
    d["personal"]  = d.pop("owner_user_id") is not None
    return d


@router.get("/{account_id}/balance")
def get_balance(account_id: int, request: Request, db=Depends(get_db)):
    me = current_profile_id(request)
    own_sql, own_params = ownership_filter(me, "all", column="owner_user_id")
    row = db.execute(
        f"SELECT id, name FROM budget_accounts WHERE id = ? AND {own_sql}",
        (account_id, *own_params)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    result = db.execute(
        """SELECT COALESCE(SUM(amount_cents), 0) FROM transactions
           WHERE account_id = ? AND (cleared IS NULL OR cleared != 'Unverified')""",
        (account_id,)
    ).fetchone()
    return {"account_id": account_id, "name": row["name"], "balance": from_cents(result[0])}


@router.post("/", status_code=201)
def add_account(body: AccountIn, request: Request, db=Depends(get_db)):
    me = current_profile_id(request)
    owner = None
    if body.personal:
        if me is None:
            raise HTTPException(status_code=400, detail="Sign in with a profile to create a personal account")
        owner = me
    try:
        next_pos = db.execute(
            "SELECT COALESCE(MAX(position), -1) + 1 FROM budget_accounts"
        ).fetchone()[0]
        cur = db.execute(
            "INSERT INTO budget_accounts (name, institution, number, on_budget, position, owner_user_id) VALUES (?, ?, ?, ?, ?, ?)",
            (body.name, body.institution, body.number, 1 if body.on_budget else 0, next_pos, owner)
        )
        db.commit()
        return {"id": cur.lastrowid, **body.model_dump(), "personal": owner is not None}
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Account name already exists")


@router.patch("/{account_id}")
def update_account(account_id: int, body: AccountUpdate, request: Request, db=Depends(get_db)):
    me = current_profile_id(request)
    own_sql, own_params = ownership_filter(me, "all", column="owner_user_id")
    row = db.execute(
        f"SELECT id, name, institution, number, on_budget, vault_item_id, owner_user_id "
        f"FROM budget_accounts WHERE id = ? AND {own_sql}",
        (account_id, *own_params)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    new_name          = body.name          if body.name          is not None else row["name"]
    new_institution   = body.institution   if body.institution   is not None else row["institution"]
    new_number        = body.number        if body.number        is not None else row["number"]
    new_on_budget     = (1 if body.on_budget else 0) if body.on_budget is not None else row["on_budget"]
    new_vault_item_id = body.vault_item_id if body.vault_item_id is not None else row["vault_item_id"]
    new_owner         = row["owner_user_id"]
    if body.personal is not None:
        if body.personal:
            if me is None:
                raise HTTPException(status_code=400, detail="Sign in with a profile to make an account personal")
            new_owner = me
        else:
            new_owner = None
    try:
        db.execute(
            "UPDATE budget_accounts SET name = ?, institution = ?, number = ?, on_budget = ?, vault_item_id = ?, owner_user_id = ? WHERE id = ?",
            (new_name, new_institution, new_number, new_on_budget, new_vault_item_id, new_owner, account_id)
        )
        db.commit()
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Account name already exists")
    return {
        "id":            account_id,
        "name":          new_name,
        "institution":   new_institution,
        "number":        new_number,
        "on_budget":     bool(new_on_budget),
        "vault_item_id": new_vault_item_id,
        "personal":      new_owner is not None,
    }


@router.delete("/{account_id}", status_code=204)
def delete_account(account_id: int, request: Request, db=Depends(get_db)):
    me = current_profile_id(request)
    own_sql, own_params = ownership_filter(me, "all", column="owner_user_id")
    row = db.execute(
        f"SELECT id FROM budget_accounts WHERE id = ? AND {own_sql}",
        (account_id, *own_params)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Account not found")
    for tbl in ("scheduled", "transactions"):
        n = db.execute(
            f"SELECT COUNT(*) FROM {tbl} WHERE account_id = ?", (account_id,)
        ).fetchone()[0]
        if n > 0:
            raise HTTPException(status_code=409, detail=f"Account referenced by {n} {tbl}")
    db.execute("DELETE FROM budget_accounts WHERE id = ?", (account_id,))
    db.commit()
