# =============================================================================
# routers/status.py — Status module: an up/down monitor for the household's
# services & equipment.
#
# Each check is an HTTP URL or a host:port TCP target the admin defines; a GET
# probes them all concurrently and returns reachability + latency. No docker
# socket, no agent — just reachability, which also covers non-container gear
# (a NAS, a printer, a Pi) by host:port. Own table; stdlib only.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request, Depends
from pydantic import BaseModel
from typing import Optional
from concurrent.futures import ThreadPoolExecutor
import os, sqlite3, socket, time, urllib.request, urllib.error

from routers.auth import get_db as _connect, current_user_from_request

router = APIRouter(prefix="/status", tags=["status"])

KINDS = ("http", "tcp")
PROBE_TIMEOUT = 4


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
            CREATE TABLE IF NOT EXISTS status_checks (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL,
                kind       TEXT NOT NULL DEFAULT 'http',
                target     TEXT NOT NULL,
                sort       INTEGER NOT NULL DEFAULT 0,
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


def _probe(check: dict) -> dict:
    """Reachability + latency for one check. Any HTTP response (even 4xx/5xx)
    counts as up — the service answered; only a refused/timed-out/DNS-failed
    connection is down."""
    kind, target = check["kind"], (check["target"] or "").strip()
    t0 = time.monotonic()
    ms = lambda: int((time.monotonic() - t0) * 1000)
    try:
        if kind == "tcp":
            host, _, port = target.rpartition(":")
            if not host or not port.isdigit():
                return {"up": False, "latency_ms": None, "detail": "bad host:port"}
            with socket.create_connection((host, int(port)), timeout=PROBE_TIMEOUT):
                return {"up": True, "latency_ms": ms(), "detail": "open"}
        url = target if target.startswith(("http://", "https://")) else "http://" + target
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "thrive-status/0.1"})
        with urllib.request.urlopen(req, timeout=PROBE_TIMEOUT) as r:
            return {"up": r.status < 400, "latency_ms": ms(), "detail": f"HTTP {r.status}"}
    except urllib.error.HTTPError as e:
        return {"up": True, "latency_ms": ms(), "detail": f"HTTP {e.code}"}
    except (urllib.error.URLError, socket.timeout, OSError) as e:
        reason = getattr(e, "reason", e)
        return {"up": False, "latency_ms": None, "detail": str(reason)[:48] or type(e).__name__}


class CheckIn(BaseModel):
    name: str
    kind: Optional[str] = "http"
    target: str

class CheckPatch(BaseModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    target: Optional[str] = None
    sort: Optional[int] = None


def _kind(v: Optional[str]) -> str:
    v = (v or "http").strip().lower()
    return v if v in KINDS else "http"


@router.get("")
def list_status(request: Request, db=Depends(get_db)):
    """All checks, each probed live (concurrently)."""
    _auth(request)
    checks = [dict(r) for r in db.execute(
        "SELECT id, name, kind, target, sort FROM status_checks ORDER BY sort, id"
    ).fetchall()]
    if checks:
        with ThreadPoolExecutor(max_workers=min(8, len(checks))) as ex:
            for c, res in zip(checks, ex.map(_probe, checks)):
                c.update(res)
    return checks


@router.post("", status_code=201)
def add_check(body: CheckIn, request: Request, db=Depends(get_db)):
    _auth(request)
    name = (body.name or "").strip()
    target = (body.target or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name required")
    if not target:
        raise HTTPException(status_code=400, detail="Target required")
    nxt = db.execute("SELECT COALESCE(MAX(sort), -1) + 1 FROM status_checks").fetchone()[0]
    cur = db.execute("INSERT INTO status_checks (name, kind, target, sort) VALUES (?, ?, ?, ?)",
                     (name, _kind(body.kind), target, nxt))
    db.commit()
    return {"id": cur.lastrowid, "name": name, "kind": _kind(body.kind), "target": target, "sort": nxt}


@router.patch("/{check_id}")
def update_check(check_id: int, body: CheckPatch, request: Request, db=Depends(get_db)):
    _auth(request)
    if not db.execute("SELECT id FROM status_checks WHERE id=?", (check_id,)).fetchone():
        raise HTTPException(status_code=404, detail="Not found")
    if body.name is not None:
        n = body.name.strip()
        if not n:
            raise HTTPException(status_code=400, detail="Name can't be empty")
        db.execute("UPDATE status_checks SET name=? WHERE id=?", (n, check_id))
    if body.kind is not None:
        db.execute("UPDATE status_checks SET kind=? WHERE id=?", (_kind(body.kind), check_id))
    if body.target is not None:
        t = body.target.strip()
        if not t:
            raise HTTPException(status_code=400, detail="Target can't be empty")
        db.execute("UPDATE status_checks SET target=? WHERE id=?", (t, check_id))
    if body.sort is not None:
        db.execute("UPDATE status_checks SET sort=? WHERE id=?", (body.sort, check_id))
    db.commit()
    return {"ok": True}


@router.delete("/{check_id}", status_code=204)
def delete_check(check_id: int, request: Request, db=Depends(get_db)):
    _auth(request)
    db.execute("DELETE FROM status_checks WHERE id=?", (check_id,))
    db.commit()
