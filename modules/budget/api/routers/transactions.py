# =============================================================================
# transactions.py — Budget module: transaction CRUD, import, verify, bulk, splits
# thrive module `budget`
# =============================================================================

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from typing import Optional, List
import sqlite3

from routers.auth import get_db as _connect, current_profile_id, visible_owned_ids

import os, sqlite3

router = APIRouter(prefix="/transactions", tags=["transactions"])

CLEARED_VALUES = {"Cleared", "Reconciled", "Unverified"}


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

def _in(ids):
    """(placeholder_group, params) for `col IN <group>`; matches nothing if empty."""
    return (f"({','.join('?' * len(ids))})", list(ids)) if ids else ("(NULL)", [])

# ── write guards (personal-data): you can't mutate accounts/transactions you
# can't see, even by guessing ids ───────────────────────────────────────────
def _visible_set(db, request):
    return set(visible_owned_ids(db, "budget_accounts", current_profile_id(request)))

def _assert_accounts_visible(db, request, *account_ids):
    visible = _visible_set(db, request)
    for aid in account_ids:
        if aid is not None and aid not in visible:
            raise HTTPException(status_code=404, detail="Account not found")

def _assert_txn_visible(db, request, transaction_id):
    row = db.execute("SELECT account_id FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if row is None or row["account_id"] not in _visible_set(db, request):
        raise HTTPException(status_code=404, detail="Transaction not found")

def _visible_txn_ids(db, request, ids):
    """Subset of `ids` whose transactions sit on accounts the viewer can see."""
    if not ids:
        return []
    visible = _visible_set(db, request)
    ph = ",".join("?" * len(ids))
    rows = db.execute(f"SELECT id, account_id FROM transactions WHERE id IN ({ph})", list(ids)).fetchall()
    return [r["id"] for r in rows if r["account_id"] in visible]

def init_db():
    db = _connect()
    try:
        db.execute("""
            CREATE TABLE IF NOT EXISTS transactions (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id              INTEGER NOT NULL REFERENCES budget_accounts(id),
                payee_id                INTEGER REFERENCES payees(id),
                category_id             INTEGER REFERENCES categories(id),
                amount_cents            INTEGER NOT NULL,
                date                    TEXT NOT NULL,
                memo                    TEXT,
                cleared                 TEXT CHECK(cleared IS NULL
                                            OR cleared IN ('Cleared','Reconciled','Unverified')),
                transfer_account_id     INTEGER REFERENCES budget_accounts(id),
                transfer_transaction_id INTEGER REFERENCES transactions(id),
                matched_transaction_id  INTEGER REFERENCES transactions(id),
                import_description      TEXT,
                import_category         TEXT,
                plaid_id                TEXT
            )
        """)
        db.execute("""
            CREATE TABLE IF NOT EXISTS splits (
                id             INTEGER PRIMARY KEY AUTOINCREMENT,
                transaction_id INTEGER NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
                category_id    INTEGER REFERENCES categories(id),
                amount_cents   INTEGER NOT NULL,
                memo           TEXT
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()


class TransactionIn(BaseModel):
    account_id:             int
    amount:                 float
    date:                   str
    payee_id:               Optional[int] = None
    category_id:            Optional[int] = None
    transfer_account_id:    Optional[int] = None
    matched_transaction_id: Optional[int] = None
    memo:                   Optional[str] = None
    cleared:                Optional[str] = None


class TransactionUpdate(BaseModel):
    account_id:          Optional[int]   = None
    amount:              Optional[float] = None
    date:                Optional[str]   = None
    payee_id:            Optional[int]   = None
    category_id:         Optional[int]   = None
    transfer_account_id: Optional[int]   = None
    memo:                Optional[str]   = None
    cleared:             Optional[str]   = None


class ImportRow(BaseModel):
    account_id:             int
    amount:                 float
    date:                   str
    memo:                   Optional[str] = None
    matched_transaction_id: Optional[int] = None
    import_description:     Optional[str] = None
    import_category:        Optional[str] = None


class SplitIn(BaseModel):
    category_id: Optional[int] = None
    amount:      float
    memo:        Optional[str] = None


class VerifyMatchBody(BaseModel):
    payee_id:            Optional[int]       = None
    category_id:         Optional[int]       = None
    transfer_account_id: Optional[int]       = None
    memo:                Optional[str]       = None
    raw_name:            Optional[str]       = None
    cleared:             Optional[str]       = None
    splits:              Optional[List[SplitIn]] = None  # if set, creates splits instead of single category


# --- Bulk operation models ---

class BulkIds(BaseModel):
    ids: List[int]

class BulkStatus(BaseModel):
    ids:     List[int]
    cleared: str

class BulkCategory(BaseModel):
    ids:         List[int]
    category_id: Optional[int] = None

class BulkPayee(BaseModel):
    ids:      List[int]
    payee_id: Optional[int] = None


_SELECT = """
    SELECT t.id, t.date, t.account_id, a.name as account_name,
           t.payee_id, p.name as payee_name,
           t.category_id,
           t.transfer_account_id,
           t.transfer_transaction_id,
           t.matched_transaction_id,
           t.import_description,
           t.import_category,
           CASE WHEN t.transfer_account_id IS NOT NULL
                THEN 'Transfer:' || ta.name
                WHEN parent.name IS NOT NULL
                THEN parent.name || ':' || c.name
                ELSE c.name END as category_name,
           t.amount_cents, t.memo, t.cleared,
           EXISTS(SELECT 1 FROM splits s WHERE s.transaction_id = t.id) as has_splits
    FROM transactions t
    JOIN budget_accounts a ON a.id = t.account_id
    LEFT JOIN payees p ON p.id = t.payee_id
    LEFT JOIN categories c ON c.id = t.category_id
    LEFT JOIN categories parent ON parent.id = c.parent_id
    LEFT JOIN budget_accounts ta ON ta.id = t.transfer_account_id
"""

_SPLITS_SELECT = """
    SELECT s.id, s.transaction_id, s.category_id, s.amount_cents, s.memo,
           CASE WHEN parent.name IS NOT NULL
                THEN parent.name || ':' || c.name
                ELSE c.name END as category_name
    FROM splits s
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN categories parent ON parent.id = c.parent_id
"""


def _fetch_splits_for_ids(transaction_ids: list, db) -> dict:
    """Fetch all splits for a list of transaction IDs. Returns dict keyed by transaction_id."""
    if not transaction_ids:
        return {}
    placeholders = ",".join("?" * len(transaction_ids))
    rows = db.execute(f"""
        {_SPLITS_SELECT}
        WHERE s.transaction_id IN ({placeholders})
        ORDER BY s.id
    """, transaction_ids).fetchall()
    result = {}
    for r in rows:
        d = dict(r)
        d["amount"] = from_cents(d.pop("amount_cents"))
        tid = d["transaction_id"]
        if tid not in result:
            result[tid] = []
        result[tid].append(d)
    return result


def _row_to_dict(r, splits_map=None):
    d = dict(r)
    d["amount"]     = from_cents(d.pop("amount_cents"))
    d["has_splits"] = bool(d.get("has_splits", 0))
    if splits_map is not None and d["has_splits"]:
        d["splits"] = splits_map.get(d["id"], [])
    else:
        d["splits"] = []
    return d


# =============================================================================
# Routes
# =============================================================================

# columns the UI may sort by → safe SQL expressions (whitelist; never interpolate raw)
_SORT_COLUMNS = {
    "date":     "t.date",
    "payee":    "p.name",
    "category": "category_name",
    "memo":     "t.memo",
    "amount":   "t.amount_cents",
    "account":  "a.name",
    "status":   "t.cleared",
}


@router.get("/")
def list_transactions(
    request:     Request,
    account_id:  Optional[int] = Query(None),
    from_date:   Optional[str] = Query(None),
    to_date:     Optional[str] = Query(None),
    payee_id:    Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    memo:        Optional[str] = Query(None),
    sort:        str           = Query("date"),
    direction:   str           = Query("desc", alias="dir"),
    limit:       int           = Query(50, le=500),
    offset:      int           = Query(0, ge=0),
    db=Depends(get_db),
):
    # personal-data: only transactions on budget accounts this viewer can see
    visible_ids = visible_owned_ids(db, "budget_accounts", current_profile_id(request))
    vph, vparams = _in(visible_ids)
    where  = [f"t.account_id IN {vph}"]
    params = list(vparams)
    if account_id:
        where.append("t.account_id = ?")
        params.append(account_id)
    if from_date:
        where.append("t.date >= ?")
        params.append(from_date)
    if to_date:
        where.append("t.date <= ?")
        params.append(to_date)
    if payee_id:
        where.append("t.payee_id = ?")
        params.append(payee_id)
    if category_id:
        # match the category itself OR (if it's a parent) any of its children
        where.append("(t.category_id = ? OR c.parent_id = ?)")
        params.extend([category_id, category_id])
    if memo:
        where.append("(t.memo LIKE ? OR t.import_description LIKE ?)")
        params.extend([f"%{memo}%", f"%{memo}%"])

    clause = ("WHERE " + " AND ".join(where)) if where else ""

    sort_col = _SORT_COLUMNS.get(sort, "t.date")
    sort_dir = "ASC" if str(direction).lower() == "asc" else "DESC"
    order_by = f"{sort_col} {sort_dir}, t.id DESC"

    rows = db.execute(f"""
        {_SELECT}
        {clause}
        ORDER BY {order_by}
        LIMIT ? OFFSET ?
    """, params + [limit, offset]).fetchall()

    # running balance is only meaningful in the natural chronological order
    chronological = sort == "date" and sort_dir == "DESC"

    running = None
    if account_id and account_id in visible_ids and chronological:
        # Total cleared/reconciled balance for the account (Unverified excluded — they
        # don't move the running balance in the loop below either).
        total = db.execute(
            """SELECT COALESCE(SUM(amount_cents), 0) FROM transactions
               WHERE account_id = ? AND (cleared IS NULL OR cleared != 'Unverified')""",
            (account_id,)
        ).fetchone()[0]

        if offset > 0:
            # Take the same first `offset` rows the UI already rendered (all cleared
            # statuses, same ordering), then sum only the non-Unverified ones.
            # Using CASE inside the subquery avoids a second pass and keeps the
            # slice identical to what the pagination query returns.
            above = db.execute(f"""
                SELECT COALESCE(SUM(CASE WHEN t.cleared IS NULL OR t.cleared != 'Unverified'
                                         THEN t.amount_cents ELSE 0 END), 0)
                FROM (
                    SELECT t.amount_cents, t.cleared FROM transactions t
                    {clause}
                    ORDER BY t.date DESC, t.id DESC
                    LIMIT ?
                ) t
            """, params + [offset]).fetchone()[0]
            total -= above

        running = total

    # Fetch splits in one query for all rows that have them
    split_ids = [dict(r)["id"] for r in rows if dict(r).get("has_splits")]
    splits_map = _fetch_splits_for_ids(split_ids, db) if split_ids else {}

    result = []
    for r in rows:
        d = _row_to_dict(r, splits_map)
        if running is not None:
            if d["cleared"] != "Unverified":
                d["balance"] = from_cents(running)
                running -= to_cents(d["amount"])
            else:
                d["balance"] = from_cents(running)
        result.append(d)
    return result


@router.get("/lookup/payee")
def lookup_payee(raw_name: str = Query(...), db=Depends(get_db)):
    row = db.execute(
        "SELECT payee_id FROM payee_aliases WHERE raw_name = ?",
        (raw_name,)
    ).fetchone()
    return {"payee_id": row["payee_id"] if row else None}


@router.get("/{transaction_id}")
def get_transaction(transaction_id: int, request: Request, db=Depends(get_db)):
    vph, vparams = _in(visible_owned_ids(db, "budget_accounts", current_profile_id(request)))
    row = db.execute(f"{_SELECT} WHERE t.id = ? AND t.account_id IN {vph}", (transaction_id, *vparams)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    d = _row_to_dict(row)
    if d["has_splits"]:
        splits_map = _fetch_splits_for_ids([transaction_id], db)
        d["splits"] = splits_map.get(transaction_id, [])
    return d


@router.post("/", status_code=201)
def add_transaction(body: TransactionIn, request: Request, db=Depends(get_db)):
    _assert_accounts_visible(db, request, body.account_id, body.transfer_account_id)
    if body.cleared is not None and body.cleared not in CLEARED_VALUES:
        raise HTTPException(status_code=400, detail="cleared must be 'Cleared', 'Reconciled', or 'Unverified'")

    if body.transfer_account_id is not None:
        cur = db.execute(
            """INSERT INTO transactions
               (account_id, payee_id, category_id, transfer_account_id, amount_cents, date, memo, cleared)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?)""",
            (body.account_id, body.payee_id, body.transfer_account_id,
             to_cents(body.amount), body.date, body.memo, body.cleared)
        )
        main_id = cur.lastrowid
        cur2 = db.execute(
            """INSERT INTO transactions
               (account_id, payee_id, category_id, transfer_account_id, amount_cents, date, memo, cleared)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?)""",
            (body.transfer_account_id, body.payee_id, body.account_id,
             to_cents(-body.amount), body.date, body.memo, body.cleared)
        )
        paired_id = cur2.lastrowid
        db.execute("UPDATE transactions SET transfer_transaction_id = ? WHERE id = ?", (paired_id, main_id))
        db.execute("UPDATE transactions SET transfer_transaction_id = ? WHERE id = ?", (main_id, paired_id))
        db.commit()
        return {"id": main_id}

    cur = db.execute(
        """INSERT INTO transactions
           (account_id, payee_id, category_id, amount_cents, date, memo, cleared, matched_transaction_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.account_id, body.payee_id, body.category_id,
         to_cents(body.amount), body.date, body.memo, body.cleared,
         body.matched_transaction_id)
    )
    db.commit()
    return {"id": cur.lastrowid}


@router.post("/import", status_code=201)
def bulk_import(rows: List[ImportRow], request: Request, db=Depends(get_db)):
    _assert_accounts_visible(db, request, *[r.account_id for r in rows])
    inserted = []
    for row in rows:
        cur = db.execute(
            """INSERT INTO transactions
               (account_id, payee_id, category_id, amount_cents, date, memo,
                cleared, matched_transaction_id, import_description, import_category)
               VALUES (?, NULL, NULL, ?, ?, ?, 'Unverified', ?, ?, ?)""",
            (row.account_id, to_cents(row.amount), row.date, row.memo,
             row.matched_transaction_id, row.import_description, row.import_category)
        )
        inserted.append(cur.lastrowid)
    db.commit()
    return {"inserted": len(inserted), "ids": inserted}


@router.post("/{transaction_id}/verify", status_code=200)
def verify_transaction(transaction_id: int, body: VerifyMatchBody, request: Request, db=Depends(get_db)):
    _assert_txn_visible(db, request, transaction_id)
    _assert_accounts_visible(db, request, body.transfer_account_id)
    uv = db.execute(
        """SELECT id, account_id, cleared, matched_transaction_id, memo,
                  amount_cents, date
           FROM transactions WHERE id = ?""",
        (transaction_id,)
    ).fetchone()
    if uv is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if uv["cleared"] != "Unverified":
        raise HTTPException(status_code=400, detail="Transaction is not Unverified")

    use_splits = body.splits and len(body.splits) > 0

    if uv["matched_transaction_id"] is not None:
        og = db.execute(
            "SELECT id, memo FROM transactions WHERE id = ?",
            (uv["matched_transaction_id"],)
        ).fetchone()
        if og is None:
            raise HTTPException(status_code=404, detail="Matched transaction not found")

        if use_splits:
            db.execute(
                "UPDATE transactions SET payee_id = ?, category_id = NULL, memo = ? WHERE id = ?",
                (body.payee_id, body.memo, og["id"])
            )
            db.execute("DELETE FROM splits WHERE transaction_id = ?", (og["id"],))
            for split in body.splits:
                db.execute(
                    "INSERT INTO splits (transaction_id, category_id, amount_cents, memo) VALUES (?, ?, ?, ?)",
                    (og["id"], split.category_id, to_cents(split.amount), split.memo)
                )
        else:
            db.execute(
                "UPDATE transactions SET payee_id = ?, category_id = ?, memo = ? WHERE id = ?",
                (body.payee_id, body.category_id, body.memo, og["id"])
            )

        if body.raw_name and body.payee_id:
            try:
                db.execute(
                    "INSERT OR REPLACE INTO payee_aliases (raw_name, payee_id) VALUES (?, ?)",
                    (body.raw_name, body.payee_id)
                )
            except sqlite3.IntegrityError:
                pass

        db.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))

    else:
        if body.transfer_account_id is not None:
            db.execute(
                """UPDATE transactions
                   SET payee_id = ?, category_id = NULL, transfer_account_id = ?,
                       memo = ?, cleared = ?
                   WHERE id = ?""",
                (body.payee_id, body.transfer_account_id, body.memo,
                 body.cleared or 'Cleared', transaction_id)
            )
            db.execute(
                """INSERT INTO transactions
                   (account_id, payee_id, category_id, transfer_account_id,
                    amount_cents, date, memo, cleared)
                   VALUES (?, ?, NULL, ?, ?, ?, ?, 'Cleared')""",
                (body.transfer_account_id, body.payee_id, uv["account_id"],
                 -uv["amount_cents"], uv["date"], body.memo)
            )
            if body.raw_name and body.payee_id:
                try:
                    db.execute(
                        "INSERT OR REPLACE INTO payee_aliases (raw_name, payee_id) VALUES (?, ?)",
                        (body.raw_name, body.payee_id)
                    )
                except sqlite3.IntegrityError:
                    pass
        else:
            if use_splits:
                db.execute(
                    """UPDATE transactions
                       SET payee_id = ?, category_id = NULL, memo = ?, cleared = ?
                       WHERE id = ?""",
                    (body.payee_id, body.memo, body.cleared or 'Cleared', transaction_id)
                )
                db.execute("DELETE FROM splits WHERE transaction_id = ?", (transaction_id,))
                for split in body.splits:
                    db.execute(
                        "INSERT INTO splits (transaction_id, category_id, amount_cents, memo) VALUES (?, ?, ?, ?)",
                        (transaction_id, split.category_id, to_cents(split.amount), split.memo)
                    )
            else:
                db.execute(
                    """UPDATE transactions
                       SET payee_id = ?, category_id = ?, memo = ?, cleared = ?
                       WHERE id = ?""",
                    (body.payee_id, body.category_id, body.memo,
                     body.cleared or 'Cleared', transaction_id)
                )

            if body.raw_name and body.payee_id:
                try:
                    db.execute(
                        "INSERT OR REPLACE INTO payee_aliases (raw_name, payee_id) VALUES (?, ?)",
                        (body.raw_name, body.payee_id)
                    )
                except sqlite3.IntegrityError:
                    pass

    db.commit()
    return {"ok": True}


# =============================================================================
# Splits endpoints
# =============================================================================

@router.get("/{transaction_id}/splits")
def get_splits(transaction_id: int, request: Request, db=Depends(get_db)):
    """Get all splits for a transaction."""
    _assert_txn_visible(db, request, transaction_id)
    row = db.execute("SELECT id FROM transactions WHERE id = ?", (transaction_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")
    splits_map = _fetch_splits_for_ids([transaction_id], db)
    return splits_map.get(transaction_id, [])


@router.put("/{transaction_id}/splits", status_code=200)
def set_splits(transaction_id: int, splits: List[SplitIn], request: Request, db=Depends(get_db)):
    """
    Replace all splits for a transaction.
    Pass an empty list to remove splits (reverts to single-category mode).
    Validates that split amounts sum to transaction amount.
    """
    _assert_txn_visible(db, request, transaction_id)
    row = db.execute(
        "SELECT id, amount_cents FROM transactions WHERE id = ?", (transaction_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    if splits:
        split_total = sum(to_cents(s.amount) for s in splits)
        if split_total != row["amount_cents"]:
            raise HTTPException(
                status_code=400,
                detail=f"Split amounts ({from_cents(split_total)}) must equal transaction amount ({from_cents(row['amount_cents'])})"
            )

    db.execute("DELETE FROM splits WHERE transaction_id = ?", (transaction_id,))
    for split in splits:
        db.execute(
            "INSERT INTO splits (transaction_id, category_id, amount_cents, memo) VALUES (?, ?, ?, ?)",
            (transaction_id, split.category_id, to_cents(split.amount), split.memo)
        )

    # Clear category_id on parent when splits exist, restore when splits removed
    if splits:
        db.execute("UPDATE transactions SET category_id = NULL WHERE id = ?", (transaction_id,))
    db.commit()
    return {"splits": len(splits)}


@router.patch("/{transaction_id}")
def update_transaction(transaction_id: int, body: TransactionUpdate, request: Request, db=Depends(get_db)):
    _assert_txn_visible(db, request, transaction_id)
    _assert_accounts_visible(db, request, body.account_id, body.transfer_account_id)
    row = db.execute(
        """SELECT id, account_id, payee_id, category_id, transfer_account_id,
                  transfer_transaction_id, amount_cents, date, memo, cleared
           FROM transactions WHERE id = ?""",
        (transaction_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    new_account_id = body.account_id if body.account_id is not None else row["account_id"]
    new_payee_id   = body.payee_id   if body.payee_id   is not None else row["payee_id"]
    new_cents      = to_cents(body.amount) if body.amount is not None else row["amount_cents"]
    new_date       = body.date if body.date is not None else row["date"]
    new_memo       = body.memo if body.memo is not None else row["memo"]
    new_cleared    = row["cleared"]

    if body.cleared is not None:
        if body.cleared.lower() == "none":
            new_cleared = None
        elif body.cleared not in CLEARED_VALUES:
            raise HTTPException(status_code=400, detail="cleared must be 'Cleared', 'Reconciled', 'Unverified', or 'none'")
        else:
            new_cleared = body.cleared

    was_transfer = row["transfer_transaction_id"] is not None
    paired_id    = row["transfer_transaction_id"]

    # The category cell sends EITHER a transfer_account_id (make/keep a transfer)
    # OR a category_id (make it a normal category — converting away from a transfer
    # and/or a split). Picking a category is the escape hatch out of transfer/split.
    setting_transfer = body.transfer_account_id is not None
    setting_category = body.category_id is not None

    new_cat_id              = row["category_id"]
    new_transfer_account_id = row["transfer_account_id"]
    new_paired              = paired_id

    if setting_transfer:
        new_transfer_account_id = body.transfer_account_id
        new_cat_id = None
        if new_transfer_account_id == new_account_id:
            raise HTTPException(status_code=400, detail="Cannot transfer to the same account")
    elif setting_category:
        new_cat_id = body.category_id
        new_transfer_account_id = None
        db.execute("DELETE FROM splits WHERE transaction_id = ?", (transaction_id,))   # un-split

    converting_from_transfer = was_transfer and setting_category          # un-transfer
    establishing_transfer    = (not was_transfer) and setting_transfer
    if converting_from_transfer:
        new_paired = None   # break the pair link on this row

    db.execute(
        """UPDATE transactions
           SET account_id = ?, payee_id = ?, category_id = ?, transfer_account_id = ?,
               transfer_transaction_id = ?, amount_cents = ?, date = ?, memo = ?, cleared = ?
           WHERE id = ?""",
        (new_account_id, new_payee_id, new_cat_id, new_transfer_account_id, new_paired,
         new_cents, new_date, new_memo, new_cleared, transaction_id)
    )

    if converting_from_transfer:
        db.execute("DELETE FROM transactions WHERE id = ?", (paired_id,))   # drop the orphaned leg
    elif was_transfer:
        # mirror to the paired leg; if the target changed, MOVE the leg to it
        db.execute(
            """UPDATE transactions
               SET account_id = ?, transfer_account_id = ?, amount_cents = ?, date = ?, memo = ?, cleared = ?
               WHERE id = ?""",
            (new_transfer_account_id, new_account_id, -new_cents, new_date, new_memo, new_cleared, paired_id)
        )
    elif establishing_transfer:
        cur2 = db.execute(
            """INSERT INTO transactions
               (account_id, payee_id, category_id, transfer_account_id, amount_cents, date, memo, cleared)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?)""",
            (new_transfer_account_id, new_payee_id, new_account_id,
             -new_cents, new_date, new_memo, new_cleared)
        )
        pid = cur2.lastrowid
        db.execute("UPDATE transactions SET transfer_transaction_id = ? WHERE id = ?", (pid, transaction_id))
        db.execute("UPDATE transactions SET transfer_transaction_id = ? WHERE id = ?", (transaction_id, pid))

    db.commit()
    return {"id": transaction_id}


@router.delete("/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, request: Request, db=Depends(get_db)):
    _assert_txn_visible(db, request, transaction_id)
    row = db.execute(
        "SELECT id, transfer_transaction_id FROM transactions WHERE id = ?",
        (transaction_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Transaction not found")

    # If this is one leg of a transfer, DON'T delete the other leg. Unlink it so it
    # becomes a standalone transaction on its own account (that account self-corrects),
    # and mark it Uncleared so it's flagged for review.
    if row["transfer_transaction_id"] is not None:
        db.execute(
            "UPDATE transactions SET transfer_transaction_id = NULL, "
            "transfer_account_id = NULL, cleared = NULL WHERE id = ?",
            (row["transfer_transaction_id"],)
        )

    # Clear any inbound references to THIS row before deleting it, so foreign keys
    # don't fail (a transfer pair pointing back, or a matched import row).
    db.execute("UPDATE transactions SET transfer_transaction_id = NULL WHERE transfer_transaction_id = ?", (transaction_id,))
    db.execute("UPDATE transactions SET matched_transaction_id = NULL WHERE matched_transaction_id = ?", (transaction_id,))
    # splits deleted automatically via ON DELETE CASCADE
    db.execute("DELETE FROM transactions WHERE id = ?", (transaction_id,))
    db.commit()


# =============================================================================
# Bulk operations
# =============================================================================

@router.post("/bulk/delete", status_code=200)
def bulk_delete(body: BulkIds, request: Request, db=Depends(get_db)):
    body.ids = _visible_txn_ids(db, request, body.ids)
    if not body.ids:
        return {"deleted": 0}
    to_delete = set(body.ids)

    # Transfer legs of selected rows that are NOT themselves selected: unlink them
    # (clear the transfer link, mark Uncleared) instead of deleting — same rule as
    # single delete. If both legs are selected, both just get deleted below.
    pairs_to_unlink = set()
    for tid in to_delete:
        row = db.execute(
            "SELECT transfer_transaction_id FROM transactions WHERE id = ?", (tid,)
        ).fetchone()
        if row and row["transfer_transaction_id"] and row["transfer_transaction_id"] not in to_delete:
            pairs_to_unlink.add(row["transfer_transaction_id"])
    if pairs_to_unlink:
        ph = ",".join("?" * len(pairs_to_unlink))
        db.execute(
            f"UPDATE transactions SET transfer_transaction_id = NULL, transfer_account_id = NULL, "
            f"cleared = NULL WHERE id IN ({ph})",
            list(pairs_to_unlink)
        )

    placeholders = ",".join("?" * len(to_delete))
    # clear inbound refs pointing INTO the delete set so foreign keys don't fail
    db.execute(
        f"UPDATE transactions SET transfer_transaction_id = NULL WHERE transfer_transaction_id IN ({placeholders})",
        list(to_delete)
    )
    db.execute(
        f"UPDATE transactions SET matched_transaction_id = NULL WHERE matched_transaction_id IN ({placeholders})",
        list(to_delete)
    )
    # splits deleted automatically via ON DELETE CASCADE
    db.execute(f"DELETE FROM transactions WHERE id IN ({placeholders})", list(to_delete))
    db.commit()
    return {"deleted": len(to_delete)}


@router.post("/bulk/status", status_code=200)
def bulk_status(body: BulkStatus, request: Request, db=Depends(get_db)):
    if body.cleared not in CLEARED_VALUES and body.cleared.lower() != "none":
        raise HTTPException(status_code=400, detail="Invalid cleared value")
    body.ids = _visible_txn_ids(db, request, body.ids)
    if not body.ids:
        return {"updated": 0}
    new_cleared  = None if body.cleared.lower() == "none" else body.cleared
    placeholders = ",".join("?" * len(body.ids))
    db.execute(
        f"UPDATE transactions SET cleared = ? WHERE id IN ({placeholders})",
        [new_cleared] + body.ids
    )
    db.commit()
    return {"updated": len(body.ids)}


@router.post("/bulk/category", status_code=200)
def bulk_category(body: BulkCategory, request: Request, db=Depends(get_db)):
    """Assign a category — skips transactions that have splits."""
    body.ids = _visible_txn_ids(db, request, body.ids)
    if not body.ids:
        return {"updated": 0, "skipped_splits": 0}
    # Filter out split transactions
    placeholders = ",".join("?" * len(body.ids))
    split_ids = {
        r[0] for r in db.execute(
            f"SELECT DISTINCT transaction_id FROM splits WHERE transaction_id IN ({placeholders})",
            body.ids
        ).fetchall()
    }
    eligible = [i for i in body.ids if i not in split_ids]
    if eligible:
        placeholders2 = ",".join("?" * len(eligible))
        db.execute(
            f"UPDATE transactions SET category_id = ? WHERE id IN ({placeholders2})",
            [body.category_id] + eligible
        )
    db.commit()
    return {"updated": len(eligible), "skipped_splits": len(split_ids)}


@router.post("/bulk/payee", status_code=200)
def bulk_payee(body: BulkPayee, request: Request, db=Depends(get_db)):
    body.ids = _visible_txn_ids(db, request, body.ids)
    if not body.ids:
        return {"updated": 0}
    placeholders = ",".join("?" * len(body.ids))
    db.execute(
        f"UPDATE transactions SET payee_id = ? WHERE id IN ({placeholders})",
        [body.payee_id] + body.ids
    )
    db.commit()
    return {"updated": len(body.ids)}


@router.post("/bulk/verify", status_code=200)
def bulk_verify(body: BulkIds, request: Request, db=Depends(get_db)):
    body.ids = _visible_txn_ids(db, request, body.ids)
    verified = 0
    skipped  = 0

    for tid in body.ids:
        uv = db.execute(
            """SELECT id, cleared, matched_transaction_id, payee_id,
                      category_id, memo, import_description
               FROM transactions WHERE id = ?""",
            (tid,)
        ).fetchone()

        if not uv or uv["cleared"] != "Unverified" or not uv["matched_transaction_id"]:
            skipped += 1
            continue

        og = db.execute(
            "SELECT id, payee_id, category_id, memo FROM transactions WHERE id = ?",
            (uv["matched_transaction_id"],)
        ).fetchone()

        if not og:
            skipped += 1
            continue

        new_payee_id    = uv["payee_id"] or og["payee_id"]
        new_category_id = og["category_id"]
        new_memo        = og["memo"] or uv["memo"]

        db.execute(
            "UPDATE transactions SET payee_id = ?, category_id = ?, memo = ? WHERE id = ?",
            (new_payee_id, new_category_id, new_memo, og["id"])
        )
        db.execute("DELETE FROM transactions WHERE id = ?", (tid,))
        verified += 1

    db.commit()
    return {"verified": verified, "skipped": skipped}