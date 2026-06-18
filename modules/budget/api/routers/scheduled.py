# =============================================================================
# routers/scheduled.py — Budget module: recurring/scheduled transactions
# thrive module `budget`
# =============================================================================
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional
import sqlite3

from routers.auth import get_db as _connect, current_profile_id, visible_owned_ids

import os, sqlite3

router = APIRouter(prefix="/scheduled", tags=["scheduled"])


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
            CREATE TABLE IF NOT EXISTS scheduled (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id   INTEGER REFERENCES budget_accounts(id),
                payee_id     INTEGER NOT NULL REFERENCES payees(id),
                category_id  INTEGER REFERENCES categories(id),
                amount_cents INTEGER NOT NULL,
                frequency    TEXT NOT NULL CHECK(frequency IN
                                 ('weekly','biweekly','monthly','quarterly','yearly')),
                day          INTEGER CHECK(day IS NULL OR (day >= 1 AND day <= 31)),
                anchor_date  TEXT,
                transfer_account_id INTEGER REFERENCES budget_accounts(id),
                CHECK(
                    (frequency IN ('monthly','quarterly')
                        AND day IS NOT NULL AND anchor_date IS NULL)
                    OR
                    (frequency IN ('weekly','biweekly','yearly')
                        AND anchor_date IS NOT NULL AND day IS NULL)
                )
            )
        """)
        db.commit()
    finally:
        db.close()

init_db()

DOM_FREQS    = {"monthly", "quarterly"}
ANCHOR_FREQS = {"weekly", "biweekly", "yearly"}
ALL_FREQS    = DOM_FREQS | ANCHOR_FREQS


class ScheduledIn(BaseModel):
    account_id:          Optional[int]   = None
    payee_id:            int
    category_id:         Optional[int]   = None
    transfer_account_id: Optional[int]   = None
    amount:              float
    frequency:           str
    day:                 Optional[int]   = None
    anchor_date:         Optional[str]   = None


class ScheduledUpdate(BaseModel):
    account_id:          Optional[int]   = None
    payee_id:            Optional[int]   = None
    category_id:         Optional[int]   = None
    transfer_account_id: Optional[int]   = None
    amount:              Optional[float] = None
    frequency:           Optional[str]   = None
    day:                 Optional[int]   = None
    anchor_date:         Optional[str]   = None


def _validate_timing(frequency: str, day: Optional[int], anchor_date: Optional[str]):
    if frequency in ANCHOR_FREQS:
        if not anchor_date:
            raise HTTPException(status_code=400, detail=f"'{frequency}' requires anchor_date (YYYY-MM-DD)")
        return None, anchor_date
    else:
        if day is None:
            raise HTTPException(status_code=400, detail=f"'{frequency}' requires day (1-31)")
        return day, None


_SELECT = """
    SELECT s.id, s.account_id, a.name as account_name,
           s.payee_id, p.name as payee_name,
           s.category_id,
           s.transfer_account_id,
           CASE WHEN s.transfer_account_id IS NOT NULL
                THEN 'Transfer:' || ta.name
                WHEN parent.name IS NOT NULL
                THEN parent.name || ':' || c.name
                ELSE c.name END as category_name,
           s.amount_cents, s.frequency, s.day, s.anchor_date
    FROM scheduled s
    JOIN payees p ON p.id = s.payee_id
    LEFT JOIN budget_accounts a ON a.id = s.account_id
    LEFT JOIN categories c ON c.id = s.category_id
    LEFT JOIN categories parent ON parent.id = c.parent_id
    LEFT JOIN budget_accounts ta ON ta.id = s.transfer_account_id
"""


def _in(ids):
    return (f"({','.join('?' * len(ids))})", list(ids)) if ids else ("(NULL)", [])


@router.get("/")
def list_scheduled(request: Request, db=Depends(get_db)):
    vph, vparams = _in(visible_owned_ids(db, "budget_accounts", current_profile_id(request)))
    rows = db.execute(f"""
        {_SELECT}
        WHERE s.account_id IN {vph}
        ORDER BY LOWER(p.name)
    """, vparams).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["amount"] = from_cents(d.pop("amount_cents"))
        result.append(d)
    return result


@router.get("/{scheduled_id}")
def get_scheduled(scheduled_id: int, request: Request, db=Depends(get_db)):
    vph, vparams = _in(visible_owned_ids(db, "budget_accounts", current_profile_id(request)))
    row = db.execute(f"""
        {_SELECT}
        WHERE s.id = ? AND s.account_id IN {vph}
    """, (scheduled_id, *vparams)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled transaction not found")
    d = dict(row)
    d["amount"] = from_cents(d.pop("amount_cents"))
    return d


@router.post("/", status_code=201)
def add_scheduled(body: ScheduledIn, db=Depends(get_db)):
    freq = body.frequency.strip().lower()
    if freq not in ALL_FREQS:
        raise HTTPException(status_code=400, detail=f"Invalid frequency. Use: {', '.join(sorted(ALL_FREQS))}")
    use_day, use_anchor = _validate_timing(freq, body.day, body.anchor_date)

    # Transfer and category are mutually exclusive
    category_id = None if body.transfer_account_id else body.category_id

    try:
        cur = db.execute(
            """INSERT INTO scheduled
               (account_id, payee_id, category_id, transfer_account_id,
                amount_cents, frequency, day, anchor_date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (body.account_id, body.payee_id, category_id, body.transfer_account_id,
             to_cents(body.amount), freq, use_day, use_anchor)
        )
        db.commit()
        return {"id": cur.lastrowid}
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail=str(e))


@router.patch("/{scheduled_id}")
def update_scheduled(scheduled_id: int, body: ScheduledUpdate, db=Depends(get_db)):
    row = db.execute(
        """SELECT id, account_id, payee_id, category_id, transfer_account_id,
                  amount_cents, frequency, day, anchor_date
           FROM scheduled WHERE id = ?""",
        (scheduled_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled transaction not found")

    new_account_id          = body.account_id          if body.account_id          is not None else row["account_id"]
    new_payee_id            = body.payee_id            if body.payee_id            is not None else row["payee_id"]
    new_transfer_account_id = body.transfer_account_id if body.transfer_account_id is not None else row["transfer_account_id"]
    new_cents               = to_cents(body.amount)    if body.amount              is not None else row["amount_cents"]
    new_freq                = body.frequency.strip().lower() if body.frequency     else row["frequency"]
    new_day                 = body.day                 if body.day                 is not None else row["day"]
    new_anchor              = body.anchor_date         if body.anchor_date         is not None else row["anchor_date"]

    # category_id: if switching to transfer, null it out; otherwise keep/update
    if new_transfer_account_id is not None:
        new_cat_id = None
    else:
        new_cat_id = body.category_id if body.category_id is not None else row["category_id"]

    if new_freq not in ALL_FREQS:
        raise HTTPException(status_code=400, detail=f"Invalid frequency. Use: {', '.join(sorted(ALL_FREQS))}")

    use_day, use_anchor = _validate_timing(new_freq, new_day, new_anchor)

    try:
        db.execute(
            """UPDATE scheduled
               SET account_id = ?, payee_id = ?, category_id = ?, transfer_account_id = ?,
                   amount_cents = ?, frequency = ?, day = ?, anchor_date = ?
               WHERE id = ?""",
            (new_account_id, new_payee_id, new_cat_id, new_transfer_account_id,
             new_cents, new_freq, use_day, use_anchor, scheduled_id)
        )
        db.commit()
    except sqlite3.IntegrityError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"id": scheduled_id}


@router.delete("/{scheduled_id}", status_code=204)
def delete_scheduled(scheduled_id: int, db=Depends(get_db)):
    row = db.execute(
        "SELECT id FROM scheduled WHERE id = ?", (scheduled_id,)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Scheduled transaction not found")
    db.execute("DELETE FROM scheduled WHERE id = ?", (scheduled_id,))
    db.commit()