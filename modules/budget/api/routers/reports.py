# =============================================================================
# routers/reports.py — Budget module: reporting endpoints
# thrive module `budget`
# =============================================================================
from fastapi import APIRouter, Query, Request
from typing import Optional
from datetime import date, timedelta
import calendar

from routers.auth import get_db, current_profile_id, visible_owned_ids   # platform conn + ownership

router = APIRouter(prefix="/reports", tags=["reports"])


def _acct_filter(conn, request, col="t.account_id"):
    """(`col IN (...)`, params) — limits a report to the budget accounts this
    viewer can see, so personal accounts' transactions/totals stay private."""
    ids = visible_owned_ids(conn, "budget_accounts", current_profile_id(request))
    ph = f"({','.join('?' * len(ids))})" if ids else "(NULL)"
    return f"{col} IN {ph}", list(ids)


def resolve_range(range_type: str, from_date: Optional[str], to_date: Optional[str]):
    today = date.today()
    if range_type == "month":
        return today.replace(day=1).isoformat(), today.isoformat()
    if range_type == "custom" and from_date and to_date:
        return from_date, to_date
    return (today - timedelta(days=30)).isoformat(), today.isoformat()


def add_months(d: date, n: int) -> date:
    """First-of-month date n months from d (n may be negative)."""
    total = d.year * 12 + (d.month - 1) + n
    y, m = divmod(total, 12)
    return date(y, m + 1, 1)


def month_seq(d_from: str, d_to: str) -> list:
    """Every 'YYYY-MM' key from d_from..d_to inclusive — used to zero-fill gaps."""
    cur = date.fromisoformat(d_from).replace(day=1)
    end = date.fromisoformat(d_to).replace(day=1)
    out = []
    while cur <= end:
        out.append(cur.strftime("%Y-%m"))
        cur = add_months(cur, 1)
    return out


def build_breakdown(rows: list, sign: int) -> list:
    """
    sign=-1  → expenses (amount_cents < 0)
    sign=1   → income   (amount_cents > 0)
    Returns list of {id, name, total_cents, subcategories:[...]}, sorted desc.
    """
    roots: dict = {}
    for row in rows:
        cents = row["total_cents"]
        if sign == -1 and cents >= 0: continue
        if sign ==  1 and cents <= 0: continue
        abs_c = abs(cents)

        root_id   = row["root_id"]   if row["root_id"]   is not None else 0
        root_name = row["root_name"] if row["root_name"] is not None else "Uncategorized"
        sub_id    = row["sub_id"]    if row["sub_id"]    is not None else 0
        sub_name  = row["sub_name"]  if row["sub_name"]  is not None else "Uncategorized"

        if root_id not in roots:
            roots[root_id] = {"id": root_id, "name": root_name, "total_cents": 0, "subcategories": {}}
        roots[root_id]["total_cents"] += abs_c

        # only add a sub-entry when it's a real subcategory (different from the root)
        if sub_id != root_id:
            subs = roots[root_id]["subcategories"]
            if sub_id not in subs:
                subs[sub_id] = {"id": sub_id, "name": sub_name, "total_cents": 0}
            subs[sub_id]["total_cents"] += abs_c

    result = []
    for root in sorted(roots.values(), key=lambda x: -x["total_cents"]):
        root["subcategories"] = sorted(root["subcategories"].values(), key=lambda x: -x["total_cents"])
        result.append(root)
    return result


@router.get("/category-transactions")
def category_transactions(
    request:    Request,
    range_type: str           = Query("last30", alias="range"),
    from_date:  Optional[str] = Query(None,     alias="from"),
    to_date:    Optional[str] = Query(None,     alias="to"),
    root_id:    int           = Query(...),   # drilled parent (0 = Uncategorized)
    sub_id:     Optional[int] = Query(None),  # specific category_id to match; omit = whole parent group
    sign:       int           = Query(-1),    # -1 expense, 1 income
):
    """Individual transactions behind a category-breakdown slice. When sub_id is
    omitted the whole parent group (the parent itself + all its children) is
    returned; when provided, only that exact category_id (a subcategory, or the
    parent itself for its 'direct' spend)."""
    d_from, d_to = resolve_range(range_type, from_date, to_date)

    where  = ["t.date >= ?", "t.date <= ?", "t.transfer_account_id IS NULL"]
    params = [d_from, d_to]
    where.append("t.amount_cents > 0" if sign == 1 else "t.amount_cents < 0")

    if sub_id is not None:
        if sub_id == 0:
            where.append("t.category_id IS NULL")
        else:
            where.append("t.category_id = ?"); params.append(sub_id)
    else:
        if root_id == 0:
            where.append("t.category_id IS NULL")
        else:
            where.append("(t.category_id = ? OR cat.parent_id = ?)"); params.extend([root_id, root_id])

    conn = get_db()
    try:
        vsql, vparams = _acct_filter(conn, request, "t.account_id")
        where.append(vsql); params.extend(vparams)
        rows = conn.execute(f"""
            SELECT t.id, t.date, t.amount_cents,
                   COALESCE(p.name, '—')             AS payee,
                   COALESCE(cat.name, 'Uncategorized') AS category_name
            FROM transactions t
            LEFT JOIN categories cat ON cat.id = t.category_id
            LEFT JOIN payees     p   ON p.id   = t.payee_id
            WHERE {' AND '.join(where)}
            ORDER BY t.date DESC, t.id DESC
        """, params).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.get("/category-breakdown")
def category_breakdown(
    request:    Request,
    range_type: str          = Query("last30", alias="range"),
    from_date:  Optional[str] = Query(None,    alias="from"),
    to_date:    Optional[str] = Query(None,    alias="to"),
):
    d_from, d_to = resolve_range(range_type, from_date, to_date)
    conn = get_db()
    try:
        vsql, vparams = _acct_filter(conn, request, "t.account_id")
        rows = conn.execute(f"""
            SELECT
              COALESCE(parent.id,   cat.id)                    AS root_id,
              COALESCE(parent.name, cat.name, 'Uncategorized') AS root_name,
              cat.id                                            AS sub_id,
              COALESCE(cat.name, 'Uncategorized')               AS sub_name,
              SUM(t.amount_cents)                               AS total_cents
            FROM transactions t
            LEFT JOIN categories cat    ON cat.id    = t.category_id
            LEFT JOIN categories parent ON parent.id = cat.parent_id
            WHERE t.date >= ? AND t.date <= ?
              AND t.transfer_account_id IS NULL
              AND {vsql}
            GROUP BY COALESCE(parent.id, cat.id), cat.id
        """, (d_from, d_to, *vparams)).fetchall()
    finally:
        conn.close()

    rows      = [dict(r) for r in rows]
    expenses  = build_breakdown(rows, -1)
    income    = build_breakdown(rows,  1)
    return {
        "from_date": d_from,
        "to_date":   d_to,
        "expenses": {"total_cents": sum(c["total_cents"] for c in expenses), "categories": expenses},
        "income":   {"total_cents": sum(c["total_cents"] for c in income),   "categories": income},
    }


@router.get("/cash-flow")
def cash_flow(
    request:   Request,
    months:    int           = Query(12, ge=1, le=120),  # trailing window when no custom range
    from_date: Optional[str] = Query(None, alias="from"),
    to_date:   Optional[str] = Query(None, alias="to"),
):
    """Monthly income / expense / net over a span (default: the trailing `months`).
    Transfers are excluded; income is the sum of positive amounts, expense the
    magnitude of negatives, net = income − expense. Months with no activity come
    back as zeros so the series is continuous for charting."""
    today = date.today()
    if from_date and to_date:
        d_from, d_to = from_date, to_date
    else:
        d_from = add_months(today.replace(day=1), -(months - 1)).isoformat()
        d_to   = today.isoformat()

    conn = get_db()
    try:
        vsql, vparams = _acct_filter(conn, request, "t.account_id")
        rows = conn.execute(f"""
            SELECT strftime('%Y-%m', t.date) AS ym,
                   SUM(CASE WHEN t.amount_cents > 0 THEN  t.amount_cents ELSE 0 END) AS income_cents,
                   SUM(CASE WHEN t.amount_cents < 0 THEN -t.amount_cents ELSE 0 END) AS expense_cents
            FROM transactions t
            WHERE t.date >= ? AND t.date <= ? AND t.transfer_account_id IS NULL
              AND {vsql}
            GROUP BY ym
        """, (d_from, d_to, *vparams)).fetchall()
    finally:
        conn.close()

    by_month = {r["ym"]: r for r in rows}
    series = []
    for ym in month_seq(d_from, d_to):
        r   = by_month.get(ym)
        inc = r["income_cents"]  if r else 0
        exp = r["expense_cents"] if r else 0
        series.append({"month": ym, "income_cents": inc, "expense_cents": exp, "net_cents": inc - exp})

    return {
        "from_date": d_from,
        "to_date":   d_to,
        "months":    series,
        "totals": {
            "income_cents":  sum(m["income_cents"]  for m in series),
            "expense_cents": sum(m["expense_cents"] for m in series),
            "net_cents":     sum(m["net_cents"]     for m in series),
        },
    }


def _clamp_dom(y: int, m: int, day: int) -> date:
    """A day-of-month occurrence, clamped to the month's real length (e.g. a 31st
    rule lands on Feb 28/29)."""
    return date(y, m, min(day, calendar.monthrange(y, m)[1]))


def _add_year(d: date) -> date:
    try:
        return d.replace(year=d.year + 1)
    except ValueError:           # Feb 29 → Feb 28 on non-leap years
        return d.replace(year=d.year + 1, day=28)


def _occurrences(freq: str, day, anchor, win_from: date, win_to: date) -> list:
    """Concrete occurrence dates of one recurring rule within [win_from, win_to]."""
    occ = []
    if freq in ("monthly", "quarterly"):
        if day is None:
            return occ
        step = 1 if freq == "monthly" else 3      # quarterly: phase off the window start
        cur = win_from.replace(day=1)
        while cur <= win_to:
            d = _clamp_dom(cur.year, cur.month, int(day))
            if win_from <= d <= win_to:
                occ.append(d)
            cur = add_months(cur, step)
        return occ

    if not anchor:
        return occ
    d = date.fromisoformat(anchor)

    if freq == "yearly":
        while d < win_from:
            d = _add_year(d)
        while d <= win_to:
            occ.append(d); d = _add_year(d)
        return occ

    delta = timedelta(days=7 if freq == "weekly" else 14)   # weekly / biweekly
    if d < win_from:                                         # fast-forward whole periods
        d += delta * ((win_from - d).days // delta.days)
        while d < win_from:
            d += delta
    while d <= win_to:
        occ.append(d); d += delta
    return occ


@router.get("/cash-flow-projection")
def cash_flow_projection(request: Request, months: int = Query(3, ge=1, le=24)):
    """Projected monthly income / expense / net for the next `months` months,
    derived purely from scheduled (recurring) transactions — each rule expanded
    into concrete occurrences. Transfers excluded. Starts the month AFTER the
    current one, so it continues cleanly past the actuals in /cash-flow."""
    first   = add_months(date.today().replace(day=1), 1)
    win_to  = add_months(first, months) - timedelta(days=1)   # last day of the final month

    conn = get_db()
    try:
        vsql, vparams = _acct_filter(conn, request, "account_id")
        rows = conn.execute(f"""
            SELECT amount_cents, frequency, day, anchor_date
            FROM scheduled
            WHERE transfer_account_id IS NULL
              AND {vsql}
        """, vparams).fetchall()
    finally:
        conn.close()

    buckets = {ym: {"income_cents": 0, "expense_cents": 0} for ym in month_seq(first.isoformat(), win_to.isoformat())}
    for s in rows:
        for d in _occurrences(s["frequency"], s["day"], s["anchor_date"], first, win_to):
            b = buckets[d.strftime("%Y-%m")]
            cents = s["amount_cents"]
            if cents > 0: b["income_cents"]  += cents
            else:         b["expense_cents"] += -cents

    series = [
        {"month": ym, "income_cents": b["income_cents"], "expense_cents": b["expense_cents"],
         "net_cents": b["income_cents"] - b["expense_cents"], "projected": True}
        for ym, b in buckets.items()
    ]
    return {
        "from_date": first.isoformat(),
        "to_date":   win_to.isoformat(),
        "months":    series,
        "totals": {
            "income_cents":  sum(m["income_cents"]  for m in series),
            "expense_cents": sum(m["expense_cents"] for m in series),
            "net_cents":     sum(m["net_cents"]     for m in series),
        },
    }


@router.get("/scheduled-occurrences")
def scheduled_occurrences(request: Request, start: str = Query(...), end: str = Query(...)):
    """Every scheduled (recurring) transaction expanded into concrete dated
    occurrences within [start, end] (inclusive, ISO YYYY-MM-DD — datetime strings
    are accepted and truncated). Read-only feed for other modules to overlay
    upcoming bills/income, e.g. the calendar. type in income|expense|transfer."""
    win_from = date.fromisoformat(start[:10])
    win_to   = date.fromisoformat(end[:10])
    conn = get_db()
    try:
        vsql, vparams = _acct_filter(conn, request, "s.account_id")
        rows = conn.execute(f"""
            SELECT s.id, s.amount_cents, s.frequency, s.day, s.anchor_date,
                   s.transfer_account_id,
                   p.name AS payee_name,
                   a.name AS account_name,
                   CASE WHEN s.transfer_account_id IS NOT NULL THEN 'Transfer:' || ta.name
                        WHEN parent.name IS NOT NULL THEN parent.name || ':' || c.name
                        ELSE c.name END AS category_name
            FROM scheduled s
            JOIN payees p ON p.id = s.payee_id
            LEFT JOIN budget_accounts a      ON a.id = s.account_id
            LEFT JOIN categories c           ON c.id = s.category_id
            LEFT JOIN categories parent      ON parent.id = c.parent_id
            LEFT JOIN budget_accounts ta     ON ta.id = s.transfer_account_id
            WHERE {vsql}
        """, vparams).fetchall()
    finally:
        conn.close()

    out = []
    for s in rows:
        cents = s["amount_cents"]
        kind  = "transfer" if s["transfer_account_id"] is not None else ("income" if cents > 0 else "expense")
        for d in _occurrences(s["frequency"], s["day"], s["anchor_date"], win_from, win_to):
            out.append({
                "scheduled_id": s["id"],
                "date":         d.isoformat(),
                "title":        s["payee_name"],
                "amount_cents": cents,
                "type":         kind,
                "category":     s["category_name"],
                "account":      s["account_name"],
            })
    out.sort(key=lambda o: o["date"])
    return {"start": win_from.isoformat(), "end": win_to.isoformat(), "occurrences": out}