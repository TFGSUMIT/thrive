# =============================================================================
# main.py — thrive API
# Platform shell: auth gate + module loader.
# Modules register their own routers via modules.py bootstrap.
# =============================================================================
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from routers.auth import router as auth_router, current_user_from_request, PUBLIC_PATHS
from routers.accounts import router as accounts_router
import modules as mod_registry

app = FastAPI(title="thrive", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── auth gate ────────────────────────────────────────────────────────────────
@app.middleware("http")
async def auth_gate(request: Request, call_next):
    path = request.url.path
    if request.method == "OPTIONS" or path in PUBLIC_PATHS:
        return await call_next(request)
    user = current_user_from_request(request)
    if not user:
        return JSONResponse({"detail": "Not authenticated"}, status_code=401)
    request.state.user = user
    return await call_next(request)

# ── core routers ──────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(accounts_router)

# ── modules api ───────────────────────────────────────────────────────────────
@app.get("/modules")
def get_modules():
    """List all installed modules with enabled state."""
    return mod_registry.list_modules()

@app.patch("/modules/{module_id}")
def update_module(module_id: str, request: Request, body: dict):
    """Install/uninstall or enable/disable a module (admin only).

    Body accepts `installed` (install ⇒ also enables; uninstall ⇒ also disables)
    or `enabled` (toggle an already-installed module on/off).
    """
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")

    # icon / color overrides — take effect immediately (no restart needed)
    if "icon" in body or "color" in body:
        ok = True
        if "icon" in body:  ok = ok and mod_registry.set_module_icon(module_id, body.get("icon"))
        if "color" in body: ok = ok and mod_registry.set_module_color(module_id, body.get("color"))
        if not ok:
            raise HTTPException(status_code=404, detail="Module not found")
        return {"ok": True}

    if "installed" in body:
        want = bool(body["installed"])
        if not want and mod_registry.is_core_module(module_id):
            raise HTTPException(status_code=400, detail="Cannot uninstall a core module")
        ok = mod_registry.set_module_installed(module_id, want)
    elif "enabled" in body:
        want = bool(body["enabled"])
        if not want and mod_registry.is_core_module(module_id):
            raise HTTPException(status_code=400, detail="Cannot disable a core module")
        ok = mod_registry.set_module_enabled(module_id, want)
    else:
        raise HTTPException(status_code=400, detail="Missing 'installed' or 'enabled' field")

    if not ok:
        raise HTTPException(status_code=404, detail="Module not found")
    return {"ok": True, "note": "Restart API to apply changes"}

# ── platform settings ─────────────────────────────────────────────────────────
@app.get("/settings")
def get_settings():
    """Server-wide platform settings (any signed-in user). `front_page` is the
    module id (or 'landing') loaded at '/'; null = auto (single module, else home)."""
    return {"front_page": mod_registry.get_setting("front_page")}

@app.patch("/settings")
def update_settings(request: Request, body: dict):
    """Update platform settings (admin only)."""
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    if "front_page" in body:
        mod_registry.set_setting("front_page", body.get("front_page"))
    return {"ok": True, "front_page": mod_registry.get_setting("front_page")}

# ── health ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "platform": "thrive"}

# ── bootstrap modules on startup ──────────────────────────────────────────────
@app.on_event("startup")
def startup():
    mod_registry.bootstrap(app)