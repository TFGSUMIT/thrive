# =============================================================================
# main.py — thrive API
# Platform shell: auth gate + module loader.
# Modules register their own routers via modules.py bootstrap.
# =============================================================================
import os, socket
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
    # per-module access enforcement (#25): module routes require the viewer's
    # level for the method (read for GET/HEAD, write for mutations); admins bypass.
    # Core/platform routes own no module → pass through to their own checks.
    mid = mod_registry.module_for_path(path)
    if mid and not mod_registry.access_ok(user, mid, request.method):
        return JSONResponse({"detail": "You don't have access to this module"}, status_code=403)
    return await call_next(request)

# ── core routers ──────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(accounts_router)

# ── modules api ───────────────────────────────────────────────────────────────
@app.get("/modules")
def get_modules(request: Request):
    """Installed modules + the current viewer's per-module access level (#7 Phase B)."""
    return mod_registry.list_modules_for(current_user_from_request(request))

@app.get("/permissions")
def get_permissions(request: Request):
    """Admin: Household + every profile with its per-module access level (#7 Phase B)."""
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return mod_registry.permissions_matrix()

@app.put("/permissions")
def put_permission(request: Request, body: dict):
    """Admin: set one (subject, module) access level. user_id 0 = Household."""
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    uid, mid, level = body.get("user_id"), body.get("module_id"), body.get("level")
    if uid is None or not mid or level not in mod_registry.LEVELS:
        raise HTTPException(status_code=400, detail="user_id, module_id, and a valid level are required")
    if not mod_registry.set_access(int(uid), mid, level):
        raise HTTPException(status_code=400, detail="Could not set access")
    return {"ok": True}

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

    activated = False
    if "installed" in body:
        want = bool(body["installed"])
        if not want and mod_registry.is_core_module(module_id):
            raise HTTPException(status_code=400, detail="Cannot uninstall a core module")
        ok = mod_registry.set_module_installed(module_id, want)
        activated = want
    elif "enabled" in body:
        want = bool(body["enabled"])
        if not want and mod_registry.is_core_module(module_id):
            raise HTTPException(status_code=400, detail="Cannot disable a core module")
        ok = mod_registry.set_module_enabled(module_id, want)
        activated = want
    else:
        raise HTTPException(status_code=400, detail="Missing 'installed' or 'enabled' field")

    if not ok:
        raise HTTPException(status_code=404, detail="Module not found")

    # enabling/installing: load the module's routers live so it works without an
    # API restart. disabling leaves them dormant (the UI gates the module off).
    if activated:
        mod_registry.hot_load_module(request.app, module_id)
        return {"ok": True, "active": True}
    return {"ok": True, "note": "Disabled — its API stays dormant until the next restart"}

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

# ── device/system info (public) ─────────────────────────────────────────────────
@app.get("/system/info")
def system_info():
    """Public device info — surfaces this machine's LAN IP so you can find/SSH the
    appliance (e.g. the wall kiosk). The container can't see the host's LAN IP, so
    the compose wrapper (thrive-compose.sh) injects it as HOST_LAN_IP at `up`."""
    return {
        "hostname":  socket.gethostname(),
        "device_ip": os.environ.get("HOST_LAN_IP") or None,
    }

# ── appliance power controls (#39) — thriveOS only ─────────────────────────────
# The API runs in a container and can't power-cycle its own host. On thriveOS a
# host-side systemd watcher (thrive-power.path) consumes request files dropped
# into the data dir — which is bind-mounted from the host (trunk/data ⇄ /data) —
# and runs reboot/poweroff/etc. The dangerous capability lives ONLY in the OS
# image: a host init unit writes a `.available` marker once the watcher is wired,
# so on a bare Docker host (e.g. nerfBase, public via Cloudflare) there's no
# watcher, no marker, and these endpoints report unavailable + refuse to act.
POWER_ACTIONS = ("reboot", "poweroff", "restart-stack", "relaunch-kiosk")
_CONTROL_DIR  = os.path.join(os.path.dirname(os.environ.get("DB_FILE", "/data/thrive.db")), "control")
_POWER_MARKER = os.path.join(_CONTROL_DIR, ".available")

def _power_available() -> bool:
    return os.path.exists(_POWER_MARKER)

@app.get("/system/power")
def power_status(request: Request):
    """Whether host power controls are wired (a thriveOS appliance) + the actions
    on offer. Any signed-in user may read; only admins may act."""
    user = current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    avail = _power_available()
    return {"available": avail,
            "actions": list(POWER_ACTIONS) if avail else [],
            "is_admin": user.get("role") == "admin"}

@app.post("/system/power")
def power_action(request: Request, body: dict):
    """Admin: queue a host power action by dropping a request file the host
    watcher executes. The verb travels in the FILENAME (allowlisted here); the
    host never executes file contents. Refuses when the channel isn't present."""
    user = current_user_from_request(request)
    if not user or user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    action = (body.get("action") or "").strip()
    if action not in POWER_ACTIONS:
        raise HTTPException(status_code=400, detail="Unknown action")
    if not _power_available():
        raise HTTPException(status_code=409, detail="Power control isn't available on this host")
    try:
        os.makedirs(_CONTROL_DIR, exist_ok=True)
        with open(os.path.join(_CONTROL_DIR, f"request-{action}"), "w") as f:
            f.write(f"{action} requested by {user.get('username') or '?'}\n")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't queue request: {e}")
    return {"ok": True, "action": action}

# ── bootstrap modules on startup ──────────────────────────────────────────────
@app.on_event("startup")
def startup():
    mod_registry.bootstrap(app)