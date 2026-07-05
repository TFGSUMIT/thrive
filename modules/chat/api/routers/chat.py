# =============================================================================
# routers/chat.py — chat module: a simple chat over local models.
#
# A thin proxy to one or more OpenAI-compatible hosts. The browser never talks to
# them directly (they're LAN-only; mixed-content/CORS would block it) — the thrive
# API relays: a merged model list + a streaming chat-completions passthrough.
#
# Endpoints:
#   • LM Studio — the lmstudio module's configured host (shared thrive.db →
#     lmstudio_config.base_url), else the LMSTUDIO_BASE env default.
#   • Extras — any additional OpenAI base URLs (e.g. a standalone llama-server such
#     as ZAYA on :8090), from the chat_config 'extra_endpoints' row (JSON list) or
#     the CHAT_EXTRA_ENDPOINTS env (comma-separated). Each request routes to the
#     endpoint that actually serves the chosen model.
#
# All cross-module ties are feature-detected via the shared DB — no hard deps.
# =============================================================================
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse
import os, json, time
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/chat", tags=["chat"])

DEFAULT_BASE = os.environ.get("LMSTUDIO_BASE", "http://192.168.8.105:1234")


def init_db():
    conn = get_db()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS chat_config (key TEXT PRIMARY KEY, value TEXT)")
        conn.commit()
    finally:
        conn.close()


init_db()


def _lm_base() -> str:
    """LM Studio base URL — the lmstudio module's config if set, else env default."""
    try:
        conn = get_db()
        try:
            row = conn.execute("SELECT value FROM lmstudio_config WHERE key='base_url'").fetchone()
            if row and row[0]:
                return row[0].rstrip("/")
        finally:
            conn.close()
    except Exception:
        pass
    return DEFAULT_BASE.rstrip("/")


def _extra_bases() -> list:
    """Additional OpenAI-compatible base URLs (chat_config row first, then env)."""
    try:
        conn = get_db()
        try:
            r = conn.execute("SELECT value FROM chat_config WHERE key='extra_endpoints'").fetchone()
            if r and r[0]:
                return [u.rstrip("/") for u in json.loads(r[0]) if u]
        finally:
            conn.close()
    except Exception:
        pass
    return [u.strip().rstrip("/") for u in os.environ.get("CHAT_EXTRA_ENDPOINTS", "").split(",") if u.strip()]


def _endpoints() -> list:
    eps = [_lm_base()]
    for u in _extra_bases():
        if u and u not in eps:
            eps.append(u)
    return eps


def _broken_models() -> set:
    """Models with a failed-load record and zero successes (the #86 scoreboard) —
    hidden from the picker so dead entries (e.g. LM Studio's unloadable zaya GGUFs)
    don't clutter it. Empty if the lmstudio module isn't present."""
    try:
        conn = get_db()
        try:
            tabs = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "lmstudio_model_stats" not in tabs:
                return set()
            return {r[0] for r in conn.execute(
                "SELECT model FROM lmstudio_model_stats WHERE fail > 0 AND success = 0")}
        finally:
            conn.close()
    except Exception:
        return set()


_CACHE = {"ts": 0.0, "map": {}}
_TTL = 30.0


async def _model_map(force: bool = False) -> dict:
    """model_id → base_url, by querying each endpoint's /v1/models (cached ~30s).
    First endpoint to claim a model id wins (LM Studio before extras)."""
    if not force and _CACHE["map"] and (time.time() - _CACHE["ts"] < _TTL):
        return _CACHE["map"]
    mp = {}
    for base in _endpoints():
        try:
            async with httpx.AsyncClient(timeout=6.0) as client:
                r = await client.get(f"{base}/v1/models")
                r.raise_for_status()
                for m in r.json().get("data", []):
                    mid = m.get("id", "")
                    if mid and mid not in mp:
                        mp[mid] = base
        except Exception:
            pass
    _CACHE.update(ts=time.time(), map=mp)
    return mp


def _record_ai_stat(model: str, ok: bool, error: str = None):
    """Feed the lmstudio module's scoreboard (the "AI status") when present — a
    per-model success/fail tally, plus a load-log row (with reason) on failure.
    Feature-detected via the shared DB; a no-op if the lmstudio module is absent."""
    if not model:
        return
    try:
        conn = get_db()
        try:
            tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if "lmstudio_model_stats" in tables:
                col = "success" if ok else "fail"
                conn.execute(
                    f"""INSERT INTO lmstudio_model_stats (model, {col}, last_used)
                        VALUES (?, 1, datetime('now'))
                        ON CONFLICT(model) DO UPDATE SET {col}={col}+1, last_used=datetime('now')""",
                    (model,),
                )
            if not ok and "lmstudio_load_log" in tables:
                conn.execute(
                    "INSERT INTO lmstudio_load_log (model, config, ok, error) VALUES (?, NULL, 0, ?)",
                    (model, ("chat: " + (error or "failed"))[:300]),
                )
            conn.commit()
        finally:
            conn.close()
    except Exception:
        pass


@router.get("/models")
async def models():
    """Merged chat models across all endpoints (embeddings + known-broken hidden)."""
    mp = await _model_map(force=True)
    broken = _broken_models()
    ids = [m for m in mp if "embed" not in m.lower() and m not in broken]
    return {"models": ids}


@router.post("/completions")
async def completions(req: Request):
    """Streaming chat completion — routed to whichever endpoint serves the model."""
    body = await req.json()
    model = body.get("model")
    mp = await _model_map()
    base = mp.get(model)
    if not base:                       # unknown model → refresh once, else LM Studio
        base = (await _model_map(force=True)).get(model, _lm_base())
    payload = {**body, "stream": True}

    async def gen():
        got = False
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", f"{base}/v1/chat/completions", json=payload) as r:
                    if r.status_code != 200:
                        detail = (await r.aread()).decode("utf-8", "ignore")[:300]
                        _record_ai_stat(model, False, f"{r.status_code}: {detail}")
                        yield f"data: {json.dumps({'error': f'model host {r.status_code}: {detail}'})}\n\n".encode()
                        return
                    async for chunk in r.aiter_bytes():
                        got = True
                        yield chunk
            if got:
                _record_ai_stat(model, True)
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()

    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
