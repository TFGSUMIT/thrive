# =============================================================================
# routers/chat.py — chat module: a simple chat over local models.
#
# A thin proxy to LM Studio's OpenAI-compatible API. The browser never talks to
# LM Studio directly (it's LAN-only, and mixed-content/CORS would block it) — the
# thrive API relays: model list + a streaming chat-completions passthrough. The
# heavy open-webui lives separately at brain.nerfarrow.com; this is the light,
# thrive-native chat.
#
# Reuses the lmstudio module's configured host if that module is present (shared
# thrive.db → lmstudio_config.base_url); otherwise the LMSTUDIO_BASE env default.
# Feature-detected — no hard dependency on the lmstudio module.
# =============================================================================
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse
import os, json
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/chat", tags=["chat"])

DEFAULT_BASE = os.environ.get("LMSTUDIO_BASE", "http://192.168.8.105:1234")


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


def _record_ai_stat(model: str, ok: bool, error: str = None):
    """Feed the lmstudio module's scoreboard (the "AI status") when it's present —
    a per-model success/fail tally, plus a load-log row (with reason) on failure,
    so a chat model that fails to load shows up as a failed-load stat there.
    Feature-detected via the shared DB: a no-op if the lmstudio module is absent."""
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
    """Chat-capable models on the host (embedding-only models filtered out)."""
    base = _lm_base()
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{base}/v1/models")
            r.raise_for_status()
            data = r.json().get("data", [])
    except Exception as e:
        return JSONResponse({"models": [], "error": str(e)})
    ids = [m["id"] for m in data if "embed" not in m.get("id", "").lower()]
    return {"models": ids}


@router.post("/completions")
async def completions(req: Request):
    """Streaming chat completion — SSE passthrough from LM Studio to the browser."""
    body = await req.json()
    base = _lm_base()
    model = body.get("model")
    payload = {**body, "stream": True}

    async def gen():
        got = False
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream("POST", f"{base}/v1/chat/completions", json=payload) as r:
                    if r.status_code != 200:
                        detail = (await r.aread()).decode("utf-8", "ignore")[:300]
                        # the model host answered but rejected it (e.g. "Failed to
                        # load model") → record a failed stat against this model
                        _record_ai_stat(model, False, f"{r.status_code}: {detail}")
                        yield f"data: {json.dumps({'error': f'model host {r.status_code}: {detail}'})}\n\n".encode()
                        return
                    async for chunk in r.aiter_bytes():
                        got = True
                        yield chunk
            if got:
                _record_ai_stat(model, True)
        except Exception as e:
            # a transport error (host unreachable) is NOT the model's fault — don't
            # tally it against the model; just surface it.
            yield f"data: {json.dumps({'error': str(e)})}\n\n".encode()

    # X-Accel-Buffering:no tells nginx not to buffer this response, so tokens
    # stream to the browser live instead of arriving all at once.
    return StreamingResponse(
        gen(), media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )
