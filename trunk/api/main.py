# =============================================================================
# main.py — thrive API
# Platform shell: auth gate + module loader.
# Modules register their own routers via modules.py bootstrap.
# =============================================================================
import os, socket, json
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

# ── appliance Wi-Fi setup (#83) — thriveOS only ────────────────────────────────
# Same containerized-can't-touch-the-host model as Power above. A host-side helper
# (thrive-wifi) watches the bind-mounted control dir: the API drops request-wifi-*
# files, the host acts (iw scan / wpa_supplicant) and writes results back as JSON
# (wifi-status.json refreshed on a timer, wifi-scan.json on demand). The whole
# capability is gated on a `.wifi-available` marker the OS image drops — so a bare
# Docker host has no marker, no helper, and these endpoints report unavailable.
_WIFI_MARKER = os.path.join(_CONTROL_DIR, ".wifi-available")
_WIFI_STATUS = os.path.join(_CONTROL_DIR, "wifi-status.json")
_WIFI_SCAN   = os.path.join(_CONTROL_DIR, "wifi-scan.json")

def _read_json(path):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return None

def _wifi_channel() -> bool:
    """The host-side Wi-Fi helper is wired up (a thriveOS appliance)."""
    return os.path.exists(_WIFI_MARKER)

def _wifi_write_request(verb: str, payload: str = "") -> None:
    os.makedirs(_CONTROL_DIR, exist_ok=True)
    # `wifi-req-` prefix (not `request-wifi-`): the Power watcher globs `request-*`
    # in this same dir and would consume/discard our files. Keep them disjoint.
    path = os.path.join(_CONTROL_DIR, f"wifi-req-{verb}")
    # 0600: the connect payload carries the PSK; it lives only until the host
    # consumes it on the next thrive-wifi run. Written to a fresh fd so perms
    # apply before content lands.
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(payload)

def _require_signed_in(request: Request):
    user = current_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

def _require_admin(request: Request):
    user = _require_signed_in(request)
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user

@app.get("/system/wifi")
def wifi_status(request: Request):
    """Current Wi-Fi state + whether the panel should show. Any signed-in user may
    read; only admins may scan/connect/forget. `available` is true only when the
    host channel exists AND a wireless interface is actually present."""
    user = _require_signed_in(request)
    status = _read_json(_WIFI_STATUS) or {}
    available = _wifi_channel() and bool(status.get("interface"))
    return {"available": available,
            "is_admin": user.get("role") == "admin",
            "status": status}

@app.get("/system/wifi/scan")
def wifi_scan_results(request: Request):
    """Last scan results (written by the host helper). Any signed-in user."""
    _require_signed_in(request)
    return _read_json(_WIFI_SCAN) or {"networks": [], "updated": None}

@app.post("/system/wifi/scan")
def wifi_scan(request: Request):
    """Admin: queue a scan. The UI then polls GET /system/wifi/scan for results."""
    _require_admin(request)
    if not _wifi_channel():
        raise HTTPException(status_code=409, detail="Wi-Fi control isn't available on this host")
    try:
        _wifi_write_request("scan")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't queue scan: {e}")
    return {"ok": True}

@app.post("/system/wifi/connect")
def wifi_connect(request: Request, body: dict):
    """Admin: join a network. Body: {ssid, psk?} — psk omitted/empty = open network.
    The SSID+PSK travel as JSON payload to the host helper, which hands them to
    wpa_passphrase; the API never runs them."""
    _require_admin(request)
    if not _wifi_channel():
        raise HTTPException(status_code=409, detail="Wi-Fi control isn't available on this host")
    ssid = (body.get("ssid") or "").strip()
    psk  = body.get("psk") or ""
    if not ssid:
        raise HTTPException(status_code=400, detail="SSID required")
    if psk and not (8 <= len(psk) <= 63):
        raise HTTPException(status_code=400, detail="Wi-Fi password must be 8–63 characters")
    try:
        _wifi_write_request("connect", json.dumps({"ssid": ssid, "psk": psk}))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't queue connect: {e}")
    return {"ok": True, "ssid": ssid}

@app.post("/system/wifi/forget")
def wifi_forget(request: Request):
    """Admin: drop the saved network and take the radio down."""
    _require_admin(request)
    if not _wifi_channel():
        raise HTTPException(status_code=409, detail="Wi-Fi control isn't available on this host")
    try:
        _wifi_write_request("forget")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Couldn't queue forget: {e}")
    return {"ok": True}

# ── bootstrap modules on startup ──────────────────────────────────────────────
@app.on_event("startup")
def startup():
    mod_registry.bootstrap(app)