# =============================================================================
# routers/lmstudio.py — LM Studio module: local vision/LLM host
# thrive module `lmstudio`
#
# A headless infrastructure module: it ships no page, only a Settings panel and
# an API that other modules consume. Owns everything LLM/vision — model
# discovery, image enhancement, the chat/vision call, the per-model scoreboard,
# and the host config. Today it serves the Vehicles MPG tracker (odometer /
# fuel-pump digit OCR); any future module that needs a local vision model calls
# the same `/lmstudio/vision` endpoint with its own prompt.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrive.db)
#   • owns `lmstudio_config` (key/value) and `lmstudio_model_stats` tables
#   • config is served under this router (/lmstudio/config)
# =============================================================================
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from typing import Optional
import os, re, json, base64, io
import httpx
from PIL import Image, ImageEnhance, ImageOps

# The LM Studio REST API can only *read* model state. Loading/unloading lives on
# the host's websocket SDK channel (/api/llm, /api/embedding), which the lmstudio
# SDK speaks. Imported softly so a missing dep degrades only the load/unload
# routes — discovery, vision, and config keep working without it.
try:
    import lmstudio as _lms
except Exception:
    _lms = None

from routers.auth import get_db

router = APIRouter(prefix="/lmstudio", tags=["lmstudio"])

# Default host; overridable per-install via the Settings panel (config base_url).
LMSTUDIO_BASE = os.environ.get("LMSTUDIO_BASE", "http://192.168.0.50:1234")

CONFIG_DEFAULTS = {
    "base_url":      LMSTUDIO_BASE,
    "vision_model":  "",
    "extract_model": "",   # text→JSON extraction (/extract); falls back to vision_model
}


# ── db init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lmstudio_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # per-model extraction scoreboard: how often each vision model produced
        # a usable read vs. failed (error / non-JSON / unreadable)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lmstudio_model_stats (
                model     TEXT PRIMARY KEY,
                success   INTEGER NOT NULL DEFAULT 0,
                fail      INTEGER NOT NULL DEFAULT 0,
                last_used TEXT
            )
        """)
        # load-attempt log: every model load, the config tried, and whether it
        # worked — so you can see which param sets a model actually loads with
        # (and why a load failed, e.g. VRAM at a given context length).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS lmstudio_load_log (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                model      TEXT NOT NULL,
                config     TEXT,                 -- JSON of the load config tried (NULL = defaults)
                ok         INTEGER NOT NULL,      -- 1 success, 0 fail
                error      TEXT,                  -- message when ok=0
                created_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── config helpers (module-owned key/value store) ────────────────────────────
def get_cfg(key: str, default=None):
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM lmstudio_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    if row is not None and row["value"] is not None:
        return row["value"]
    return default if default is not None else CONFIG_DEFAULTS.get(key)

def set_cfg(key: str, value: str):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO lmstudio_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, value)
        )
        conn.commit()
    finally:
        conn.close()


def record_load(model: str, config: Optional[dict], ok: bool, error: Optional[str] = None):
    """Append a load attempt (model + config tried + outcome) to the load log."""
    conn = get_db()
    try:
        conn.execute(
            "INSERT INTO lmstudio_load_log (model, config, ok, error) VALUES (?, ?, ?, ?)",
            (model, json.dumps(config) if config else None, 1 if ok else 0, error)
        )
        conn.commit()
    finally:
        conn.close()


def record_model_result(model: Optional[str], ok: bool):
    """Tally an extraction outcome against the model that produced it."""
    if not model:
        return
    col = "success" if ok else "fail"
    conn = get_db()
    try:
        conn.execute(
            f"""INSERT INTO lmstudio_model_stats (model, {col}, last_used)
                VALUES (?, 1, datetime('now'))
                ON CONFLICT(model) DO UPDATE SET {col}={col}+1, last_used=datetime('now')""",
            (model,)
        )
        conn.commit()
    finally:
        conn.close()


# ── schemas ──────────────────────────────────────────────────────────────────
class ConfigSet(BaseModel):
    key:   str
    value: str

class ModelResult(BaseModel):
    model: str
    ok:    bool

class VisionRequest(BaseModel):
    b64:    str
    prompt: str
    mime:   str           = "image/jpeg"
    model:  Optional[str] = None   # override the configured default for one call

class ExtractRequest(BaseModel):
    text:       str                    # the raw text to extract from
    prompt:     str                    # instructions; must ask for JSON out
    model:      Optional[str] = None   # override the configured default
    max_tokens: int           = 4096   # extraction output can be long (many rows)


# ── config routes ────────────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    out = dict(CONFIG_DEFAULTS)
    conn = get_db()
    try:
        for r in conn.execute("SELECT key, value FROM lmstudio_config").fetchall():
            if r["value"] is not None:
                out[r["key"]] = r["value"]
    finally:
        conn.close()
    return out

@router.post("/config")
def post_config(item: ConfigSet):
    set_cfg(item.key, item.value)
    return {"ok": True, "key": item.key, "value": item.value}


@router.post("/model-result")
def post_model_result(item: ModelResult):
    """Client-reported extraction outcome. A read that returns a value is only
    credited a success once the user keeps it (e.g. logs the fill-up); retrying,
    re-cropping, or hand-editing the value reports a fail for that model."""
    record_model_result(item.model, item.ok)
    return {"ok": True}


@router.get("/model-stats")
def model_stats():
    """Per-model extraction scoreboard (success/fail/last_used + success rate)."""
    conn = get_db()
    try:
        rows = conn.execute(
            "SELECT model, success, fail, last_used FROM lmstudio_model_stats ORDER BY model"
        ).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        total = r["success"] + r["fail"]
        out.append({
            "model":     r["model"],
            "success":   r["success"],
            "fail":      r["fail"],
            "total":     total,
            "rate":      round(r["success"] / total, 3) if total else None,
            "last_used": r["last_used"],
        })
    return out


# ── model discovery ──────────────────────────────────────────────────────────
async def probe(base: str):
    """List models the host advertises, via LM Studio's /api/v1/models — richer
    than the old /api/v0 record: human display names, parameter counts, sizes,
    and a capabilities object. Shape notes: `key` is the stable model id (the one
    chat completions accept); `display_name` does NOT distinguish quant variants;
    type is "llm" | "embedding" (no "vlm" — vision lives in capabilities); load
    state is the `loaded_instances` array, each instance carrying its context
    length under `config`."""
    async with httpx.AsyncClient(timeout=5.0) as client:
        r = await client.get(f"{base}/api/v1/models")
        r.raise_for_status()
        data = r.json().get("models", [])
    out = []
    for m in data:
        caps_obj = m.get("capabilities") or {}
        # capabilities object → list of enabled capability names, with
        # "trained_for_tool_use" shortened to "tool_use" for the UI badges
        caps = [("tool_use" if k == "trained_for_tool_use" else k)
                for k, v in caps_obj.items() if v]
        inst = (m.get("loaded_instances") or [None])[0]
        out.append({
            "id":           m["key"],
            "name":         m.get("display_name") or m["key"],
            "vision":       bool(caps_obj.get("vision")),
            "type":         m.get("type"),
            "state":        "loaded" if inst else "not-loaded",
            "arch":         m.get("architecture"),
            "publisher":    m.get("publisher"),
            "quant":        (m.get("quantization") or {}).get("name"),
            "params":       m.get("params_string"),
            "size_bytes":   m.get("size_bytes"),
            "max_ctx":      m.get("max_context_length"),
            "loaded_ctx":   (inst.get("config") or {}).get("context_length") if inst else None,
            "capabilities": caps,
        })
    return out


@router.get("/status")
async def status():
    """Host reachability + the models it exposes. The frontend filters for
    `vision: true` when it needs a VLM."""
    base = get_cfg("base_url", LMSTUDIO_BASE)
    out = {"base": base, "online": False, "models": [],
           "vision_model":  get_cfg("vision_model", ""),
           "extract_model": get_cfg("extract_model", "")}
    try:
        out["models"]  = await probe(base)
        out["online"]  = True
    except Exception:
        pass
    return out


# ── model load / unload (SDK over the host's websocket channel) ───────────────
# The SDK is synchronous (websocket round-trips), so every call is offloaded to a
# worker thread to keep the event loop free while a large model loads.
class LoadRequest(BaseModel):
    model:  str
    type:   Optional[str] = None   # "embedding" → embedding ns; anything else (incl. vision) → llm
    # SDK load config, snake_case keys (context_length, gpu:{ratio}, flash_attention,
    # llama_k/v_cache_quantization_type, …). Passed straight to the SDK, which
    # validates it — bad keys/values surface as a 502. None = model defaults.
    config: Optional[dict] = None

class UnloadRequest(BaseModel):
    model: str
    type:  Optional[str] = None

def _sdk_host(base: str) -> str:
    """The SDK wants a bare host:port; config stores a full URL."""
    return re.sub(r"^https?://", "", base).rstrip("/")

def _namespace(client, model_type: Optional[str]):
    """Pick the SDK namespace for a model's type. Vision models are `llm` —
    vision is a capability, not a separate type — so only embeddings branch off."""
    return client.embedding if model_type == "embedding" else client.llm

def _load_sync(base: str, model: str, model_type: Optional[str], config: Optional[dict]) -> str:
    client = _lms.Client(_sdk_host(base))
    try:
        ns = _namespace(client, model_type)
        # .model() is get-or-load: idempotent if the model is already up. ttl=None
        # means "stay loaded until explicitly unloaded" — the user asked for it.
        handle = ns.model(model, ttl=None, config=config or None)
        return handle.identifier
    finally:
        client.close()

def _unload_sync(base: str, model: str, model_type: Optional[str]) -> None:
    client = _lms.Client(_sdk_host(base))
    try:
        _namespace(client, model_type).unload(model)
    finally:
        client.close()


@router.post("/load")
async def load_model(req: LoadRequest):
    """Load a model on the host (or no-op if already loaded), optionally pinning a
    context length. Blocks until the model is resident, so the client sees a
    finished load when this returns."""
    if _lms is None:
        raise HTTPException(status_code=503, detail="lmstudio SDK not installed in the API image")
    base = get_cfg("base_url", LMSTUDIO_BASE)
    try:
        ident = await run_in_threadpool(_load_sync, base, req.model, req.type, req.config)
    except Exception as e:
        record_load(req.model, req.config, False, str(e)[:300])
        raise HTTPException(status_code=502, detail=f"Load failed: {e}")
    record_load(req.model, req.config, True)
    return {"ok": True, "model": req.model, "identifier": ident}


@router.get("/load-log")
def load_log(model: Optional[str] = None, limit: int = 50):
    """Recent load attempts, newest first: the config tried + whether it loaded
    (with the error on failure). Optionally filtered to one model."""
    conn = get_db()
    try:
        if model:
            rows = conn.execute(
                "SELECT id, model, config, ok, error, created_at FROM lmstudio_load_log "
                "WHERE model=? ORDER BY id DESC LIMIT ?", (model, limit)).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, model, config, ok, error, created_at FROM lmstudio_load_log "
                "ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    finally:
        conn.close()
    out = []
    for r in rows:
        d = dict(r)
        try:
            d["config"] = json.loads(d["config"]) if d["config"] else None
        except Exception:
            pass
        d["ok"] = bool(d["ok"])
        out.append(d)
    return out


@router.get("/load-stats")
def load_stats():
    """Per-model load scoreboard: how many load attempts succeeded vs failed."""
    conn = get_db()
    try:
        rows = conn.execute("""
            SELECT model,
                   COALESCE(SUM(ok), 0)     AS success,
                   COALESCE(SUM(1 - ok), 0) AS fail,
                   COUNT(*)                 AS total,
                   MAX(created_at)          AS last_used
            FROM lmstudio_load_log
            GROUP BY model
            ORDER BY model
        """).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


@router.post("/unload")
async def unload_model(req: UnloadRequest):
    """Unload a model from the host, freeing its memory."""
    if _lms is None:
        raise HTTPException(status_code=503, detail="lmstudio SDK not installed in the API image")
    base = get_cfg("base_url", LMSTUDIO_BASE)
    try:
        await run_in_threadpool(_unload_sync, base, req.model, req.type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Unload failed: {e}")
    return {"ok": True, "model": req.model}


# ── image enhancement ────────────────────────────────────────────────────────
MAX_DIM = 1024  # longest side; minicpm-v chokes on larger crops (esp. square ones)

def enhance(b64: str, mime: str) -> str:
    try:
        raw = base64.b64decode(b64)
        pil = Image.open(io.BytesIO(raw))
    except Exception:
        raise HTTPException(status_code=400, detail="Could not decode image")

    # honor EXIF rotation, then flatten to RGB (drops alpha that can confuse the model)
    pil = ImageOps.exif_transpose(pil).convert("RGB")

    # hard size cap — authoritative regardless of what the frontend sends.
    pil.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)

    pil = ImageEnhance.Contrast(pil).enhance(1.6)
    pil = ImageEnhance.Sharpness(pil).enhance(2.0)

    out = io.BytesIO()
    pil.save(out, format="JPEG", quality=88)  # always JPEG — smaller, model-friendly
    return base64.b64encode(out.getvalue()).decode()


# ── model-reply JSON parsing (shared by vision + extract) ────────────────────
def _parse_json_reply(raw: str):
    clean = raw.replace("```json", "").replace("```", "").strip()
    # Vision models often read an odometer like 056197 and emit it verbatim as a
    # JSON number — but leading zeros are invalid JSON, so json.loads chokes even
    # though the digits are correct. Strip leading zeros from number literals
    # (those following a ':', ',', or '[') before parsing. Leaves "0", "0.5",
    # and quoted strings untouched.
    clean = re.sub(r'([:\[,]\s*)0+(\d)', r'\1\2', clean)
    try:
        return json.loads(clean)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"Model returned non-JSON: {raw[:200]}")


# ── vision call ──────────────────────────────────────────────────────────────
async def call_vision(b64: str, prompt: str, model: str, base: str) -> dict:
    url = f"{base}/v1/chat/completions"
    # enhance() always emits JPEG, so the data URI mime is fixed here
    payload = {
        "model": model, "max_tokens": 128, "temperature": 0,
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": prompt},
        ]}]
    }

    last_err = None
    resp = None
    for attempt in range(2):  # one retry — first multimodal call after a model load often fails
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
            break
        except httpx.HTTPStatusError as e:
            body = e.response.text[:300]
            last_err = f"LM Studio HTTP {e.response.status_code}: {body}"
        except httpx.HTTPError as e:
            last_err = f"LM Studio error: {str(e)}"
    else:
        raise HTTPException(status_code=502, detail=last_err or "Vision request failed")

    try:
        raw = resp.json()["choices"][0]["message"]["content"]
    except Exception:
        raise HTTPException(status_code=502, detail=f"Unexpected response: {resp.text[:300]}")

    return _parse_json_reply(raw)


@router.post("/vision")
async def vision(req: VisionRequest):
    """Domain-agnostic vision extraction. The caller supplies a `prompt` that
    instructs the model to return a JSON object; we enhance the image, run it
    through the configured (or overridden) vision model, and return the parsed
    JSON plus the enhanced crop so the caller can keep it as a record.

    Failure bookkeeping: a hard error (host down / non-JSON) is failed here
    against the model. A successful call that returns a "couldn't read" value
    (e.g. null) is the caller's to judge — it reports the outcome via
    /lmstudio/model-result once the user keeps or discards the read."""
    base  = get_cfg("base_url", LMSTUDIO_BASE)
    model = req.model or get_cfg("vision_model", "")
    if not model:
        raise HTTPException(status_code=400, detail="No vision model selected — pick one in Settings → LM Studio")

    enhanced = enhance(req.b64, req.mime)
    try:
        result = await call_vision(enhanced, req.prompt, model, base)
    except HTTPException:
        record_model_result(model, False)
        raise
    return {"result": result, "enhanced_b64": enhanced, "model": model}


# ── text extraction ──────────────────────────────────────────────────────────
async def call_extract(text: str, prompt: str, model: str, base: str, max_tokens: int):
    url = f"{base}/v1/chat/completions"
    payload = {
        "model": model, "max_tokens": max_tokens, "temperature": 0,
        "messages": [{"role": "user", "content": f"{prompt}\n\n{text}"}],
    }
    last_err = None
    resp = None
    for attempt in range(2):  # one retry — first call after a model load often fails
        try:
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.post(url, json=payload)
                resp.raise_for_status()
            break
        except httpx.HTTPStatusError as e:
            last_err = f"LM Studio HTTP {e.response.status_code}: {e.response.text[:300]}"
        except httpx.HTTPError as e:
            last_err = f"LM Studio error: {str(e)}"
    else:
        raise HTTPException(status_code=502, detail=last_err or "Extract request failed")

    try:
        raw = resp.json()["choices"][0]["message"]["content"]
    except Exception:
        raise HTTPException(status_code=502, detail=f"Unexpected response: {resp.text[:300]}")
    return _parse_json_reply(raw)


@router.post("/extract")
async def extract(req: ExtractRequest):
    """Domain-agnostic TEXT extraction — the sibling of /vision for callers that
    already have text (e.g. a PDF statement's text layer, #84). The caller
    supplies a `prompt` instructing the model to return JSON; we run
    prompt + text through the configured extract model (falling back to the
    vision model — LM Studio models handle text-only fine) and return the
    parsed JSON. Same failure bookkeeping as /vision."""
    base  = get_cfg("base_url", LMSTUDIO_BASE)
    model = req.model or get_cfg("extract_model", "") or get_cfg("vision_model", "")
    if not model:
        raise HTTPException(status_code=400, detail="No model selected — pick one in Settings → LM Studio")
    try:
        result = await call_extract(req.text, req.prompt, model, base, req.max_tokens)
    except HTTPException:
        record_model_result(model, False)
        raise
    return {"result": result, "model": model}
