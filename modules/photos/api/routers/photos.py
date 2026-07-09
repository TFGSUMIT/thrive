# =============================================================================
# routers/photos.py — photos module: review the dedup run's verdicts.
#
# The dedup engine (run on the host against the photo archive) sorted the
# library into dedupped/ (keepers) + dups/ + dups-metadata/ + review-similar/,
# writing one JSONL record per move to manifests/<tier>.jsonl. This router
# serves those manifests as a review queue: each moved file side-by-side with
# the file kept in its place, with two verdicts — Restore (move back to its
# original library path) or Trash (move to trash/; nothing is ever deleted).
# Near-similar pairs (both files still in the library) get their own queue.
#
# The archive is bind-mounted at /photos (modules/photos/compose.yml merges the
# volume onto the api service). Absent mount → summary reports mounted:false
# and the UI explains itself. Review verdicts land in photos_review so items
# drop out of the queue; the file moves themselves are the source of truth.
# =============================================================================
from fastapi import APIRouter, HTTPException, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
from typing import Optional
import io
import json
import mimetypes
import os
import threading

from PIL import Image, ImageOps
try:
    import pillow_heif
    pillow_heif.register_heif_opener()
except Exception:
    pass

from routers.auth import get_db

router = APIRouter(prefix="/photos", tags=["photos"])

ROOT = Path(os.environ.get("PHOTOS_ROOT", "/photos"))
LIB = ROOT / "dedupped"
TRASH = ROOT / "trash"
MANIFESTS = ROOT / "manifests"

# host-side path prefixes that may appear in manifest moved_to fields (the dedup
# ran on the host, so records carry the host's absolute paths)
HOST_PREFIXES = ("/mnt/photos/", "/photos/")

TIERS = {"tier1": "dups", "tier2": "dups-metadata", "tier3": "review-similar"}

Image.MAX_IMAGE_PIXELS = 400_000_000
THUMB_SIZE = 512


def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS photos_review (
                key        TEXT PRIMARY KEY,   -- tier item: moved_to rel path; pair: 'a||b'
                tier       TEXT NOT NULL,       -- tier1|tier2|tier3|similar
                action     TEXT NOT NULL,       -- restored|trashed|trashed_a|trashed_b|dismissed
                detail     TEXT,                -- where the file ended up
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()


init_db()


# ── manifest cache ────────────────────────────────────────────────────────────
_cache_lock = threading.Lock()
_cache: dict = {}   # name -> {"mtime": float, "entries": [...]}


def _rel_to_root(p: str) -> str:
    """Manifest moved_to fields are host-absolute; strip to ROOT-relative."""
    for pre in HOST_PREFIXES:
        if p.startswith(pre):
            return p[len(pre):]
    return p.lstrip("/")


def _load_manifest(name: str) -> list:
    path = MANIFESTS / f"{name}.jsonl"
    if not path.is_file():
        return []
    mtime = path.stat().st_mtime
    with _cache_lock:
        hit = _cache.get(name)
        if hit and hit["mtime"] == mtime:
            return hit["entries"]
    entries, seen = [], set()
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("dry_run"):
                continue
            if "moved_to" in e:
                e["moved_rel"] = _rel_to_root(e["moved_to"])
                key = e["moved_rel"]
            elif "a" in e and "b" in e:               # similar-suggested pair
                key = e["a"] + "||" + e["b"]
            else:                                      # errors.jsonl
                key = e.get("file", "") + "|" + e.get("stage", e.get("error", ""))
            if key in seen:                            # reruns re-log; keep first
                continue
            seen.add(key)
            e["key"] = key
            entries.append(e)
    with _cache_lock:
        _cache[name] = {"mtime": mtime, "entries": entries}
    return entries


def _reviewed() -> dict:
    conn = get_db()
    try:
        return {r["key"]: {"action": r["action"], "detail": r["detail"]}
                for r in conn.execute("SELECT key, action, detail FROM photos_review")}
    finally:
        conn.close()


def _record(key: str, tier: str, action: str, detail: str = None):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO photos_review (key, tier, action, detail) VALUES (?, ?, ?, ?)
               ON CONFLICT(key) DO UPDATE SET action=excluded.action,
                   detail=excluded.detail, created_at=datetime('now')""",
            (key, tier, action, detail))
        conn.commit()
    finally:
        conn.close()


def _safe(rel: str) -> Path:
    """Resolve a ROOT-relative path, refusing escapes."""
    p = (ROOT / rel).resolve()
    if not str(p).startswith(str(ROOT.resolve()) + os.sep):
        raise HTTPException(status_code=400, detail="Path outside the archive")
    return p


def _unclobbered(dest: Path) -> Path:
    """dest, or dest with __2/__3… before the suffix if something's already there."""
    if not dest.exists():
        return dest
    n = 1
    while True:
        n += 1
        cand = dest.with_name(f"{dest.stem}__{n}{dest.suffix}")
        if not cand.exists():
            return cand


# ── routes ────────────────────────────────────────────────────────────────────
@router.get("/summary")
def summary():
    mounted = LIB.is_dir() and MANIFESTS.is_dir()
    out = {"mounted": mounted, "tiers": {}, "similar": None, "errors": 0}
    if not mounted:
        return out
    reviewed = _reviewed()
    for tier in TIERS:
        entries = _load_manifest(tier)
        done = sum(1 for e in entries if e["key"] in reviewed)
        out["tiers"][tier] = {"total": len(entries), "reviewed": done}
    pairs = _load_manifest("similar-suggested")
    out["similar"] = {"total": len(pairs),
                      "reviewed": sum(1 for e in pairs if e["key"] in reviewed)}
    out["errors"] = len(_load_manifest("errors"))
    return out


@router.get("/tier/{tier}")
def tier_items(tier: str, offset: int = 0, limit: int = 24, all: int = 0):
    if tier not in TIERS:
        raise HTTPException(status_code=404, detail="No such tier")
    limit = max(1, min(limit, 100))
    entries = _load_manifest(tier)
    reviewed = _reviewed()
    if not all:
        entries = [e for e in entries if e["key"] not in reviewed]
    page = entries[offset:offset + limit]
    items = []
    for e in page:
        moved = _safe(e["moved_rel"])
        items.append({
            "key":       e["key"],
            "moved":     e["moved_rel"],
            "moved_from": e.get("moved_from"),
            "kept":      "dedupped/" + e.get("kept", ""),
            "size":      e.get("size"),
            "kept_exif": e.get("kept_exif_tags"),
            "moved_exif": e.get("moved_exif_tags"),
            "kept_px":   e.get("kept_pixels"),
            "moved_px":  e.get("moved_pixels"),
            "exists":    moved.is_file(),
            "review":    reviewed.get(e["key"]),
        })
    return {"total": len(entries), "offset": offset, "items": items}


@router.get("/similar")
def similar_items(offset: int = 0, limit: int = 24, all: int = 0):
    limit = max(1, min(limit, 100))
    entries = _load_manifest("similar-suggested")
    reviewed = _reviewed()
    if not all:
        entries = [e for e in entries if e["key"] not in reviewed]
    page = entries[offset:offset + limit]
    items = []
    for e in page:
        a, b = "dedupped/" + e["a"], "dedupped/" + e["b"]
        items.append({
            "key": e["key"], "a": a, "b": b,
            "distance": e.get("distance"),
            "a_exists": _safe(a).is_file(),
            "b_exists": _safe(b).is_file(),
            "review": reviewed.get(e["key"]),
        })
    return {"total": len(entries), "offset": offset, "items": items}


@router.get("/errors")
def errors():
    return {"items": [{"file": e.get("file"), "stage": e.get("stage"),
                       "error": e.get("error")} for e in _load_manifest("errors")]}


@router.get("/img")
def img(p: str, thumb: int = 0):
    path = _safe(p)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Not there")
    if not thumb:
        mt = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return FileResponse(path, media_type=mt)
    try:
        with Image.open(path) as im:
            im = ImageOps.exif_transpose(im)
            im.thumbnail((THUMB_SIZE, THUMB_SIZE))
            buf = io.BytesIO()
            im.convert("RGB").save(buf, format="JPEG", quality=82)
    except Exception:
        # video / non-image / unreadable → the UI shows a placeholder
        raise HTTPException(status_code=415, detail="No thumbnail")
    return Response(buf.getvalue(), media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=86400"})


class Verdict(BaseModel):
    tier:   str            # tier1|tier2|tier3
    key:    str            # the item's moved_rel
    action: str            # restore|trash


@router.post("/action")
def action(v: Verdict):
    if v.tier not in TIERS or v.action not in ("restore", "trash"):
        raise HTTPException(status_code=400, detail="Bad tier or action")
    entry = next((e for e in _load_manifest(v.tier) if e["key"] == v.key), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Not in the manifest")
    src = _safe(entry["moved_rel"])
    if not src.is_file():
        raise HTTPException(status_code=409, detail="File no longer at its manifest location")
    if v.action == "restore":
        dest = _unclobbered(_safe("dedupped/" + entry["moved_from"]))
        dest.parent.mkdir(parents=True, exist_ok=True)
    else:
        TRASH.mkdir(exist_ok=True)
        dest = _unclobbered(TRASH / src.name)
    os.rename(src, dest)
    rel = str(dest.relative_to(ROOT))
    _record(v.key, v.tier, "restored" if v.action == "restore" else "trashed", rel)
    return {"ok": True, "action": v.action, "now_at": rel}


class PairVerdict(BaseModel):
    key:    str            # 'a||b'
    action: str            # trash_a|trash_b|dismiss


@router.post("/similar/action")
def similar_action(v: PairVerdict):
    if v.action not in ("trash_a", "trash_b", "dismiss"):
        raise HTTPException(status_code=400, detail="Bad action")
    entry = next((e for e in _load_manifest("similar-suggested") if e["key"] == v.key), None)
    if not entry:
        raise HTTPException(status_code=404, detail="Not in the manifest")
    detail = None
    if v.action != "dismiss":
        rel = "dedupped/" + entry["a" if v.action == "trash_a" else "b"]
        src = _safe(rel)
        if not src.is_file():
            raise HTTPException(status_code=409, detail="File no longer in the library")
        TRASH.mkdir(exist_ok=True)
        dest = _unclobbered(TRASH / src.name)
        os.rename(src, dest)
        detail = str(dest.relative_to(ROOT))
    _record(v.key, "similar",
            "dismissed" if v.action == "dismiss" else v.action.replace("trash_", "trashed_"), detail)
    return {"ok": True, "action": v.action, "now_at": detail}
