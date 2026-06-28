# =============================================================================
# modules.py — Module discovery, registration, and management
# thrive
# =============================================================================
import os, sys, json, sqlite3, importlib.util
from pathlib import Path
from fastapi import FastAPI

DB_PATH      = os.environ.get("DB_FILE", "/data/thrive.db")
MODULES_DIR  = Path(os.environ.get("MODULES_DIR", "/app/modules"))


# ── db ─────────────────────────────────────────────────────────────────────
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_modules_table():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS modules (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                icon         TEXT,
                description  TEXT,
                version      TEXT,
                color        TEXT,
                nav_path     TEXT,
                enabled      INTEGER DEFAULT 0,
                installed    INTEGER DEFAULT 0,
                core         INTEGER DEFAULT 0,
                installed_at TEXT DEFAULT (datetime('now'))
            )
        """)
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(modules)").fetchall()]
        # migration: add `core` to pre-existing tables
        if "core" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN core INTEGER DEFAULT 0")
        # migration: add `installed` — preserve currently-live modules across the
        # upgrade so a running install isn't silently torn down.
        if "installed" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN installed INTEGER DEFAULT 0")
            conn.execute("UPDATE modules SET installed=1 WHERE enabled=1")
        # migrations: user icon/color overrides — set from the UI, never clobbered
        # by the module.json sync (which only writes the `icon`/`color` defaults).
        if "icon_override" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN icon_override TEXT")
        if "color_override" not in cols:
            conn.execute("ALTER TABLE modules ADD COLUMN color_override TEXT")
        # per-profile × per-module access (#7 Phase B). user_id 0 = the shared
        # Household identity. No row => 'none' (locked down by default, #18).
        conn.execute("""
            CREATE TABLE IF NOT EXISTS module_access (
                user_id   INTEGER NOT NULL,             -- 0 = Household (no-login shared view), else users.id
                module_id TEXT NOT NULL,
                level     TEXT NOT NULL DEFAULT 'none',  -- none | view | read | write
                PRIMARY KEY (user_id, module_id)
            )
        """)
        conn.commit()
    finally:
        conn.close()


# ── app config (core key/value settings, e.g. front_page) ────────────────────
def init_app_config():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()

def get_setting(key: str, default=None):
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM app_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    return row["value"] if row and row["value"] is not None else default

def set_setting(key: str, value: str | None):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, (value or "").strip() or None)
        )
        conn.commit()
    finally:
        conn.close()


# ── discovery ────────────────────────────────────────────────────────────────
def discover_modules() -> list[dict]:
    """Scan MODULES_DIR for valid module.json files."""
    found = []
    if not MODULES_DIR.exists():
        return found
    for entry in sorted(MODULES_DIR.iterdir()):
        if not entry.is_dir():
            continue
        manifest = entry / "module.json"
        if not manifest.exists():
            continue
        try:
            data = json.loads(manifest.read_text())
            data["_path"] = str(entry)
            found.append(data)
        except Exception as e:
            print(f"[modules] skipping {entry.name}: {e}")
    return found


def sync_registry(discovered: list[dict]):
    """Upsert discovered modules into the DB registry. Never removes."""
    conn = get_db()
    try:
        for m in discovered:
            existing = conn.execute("SELECT id FROM modules WHERE id=?", (m["id"],)).fetchone()
            core = 1 if m.get("core") else 0
            if existing:
                conn.execute(
                    "UPDATE modules SET name=?, icon=?, description=?, version=?, color=?, nav_path=?, core=? WHERE id=?",
                    (m.get("name"), m.get("icon"), m.get("description"),
                     m.get("version"), m.get("color"), m.get("nav_path"), core, m["id"])
                )
            else:
                # newly discovered modules are registered but NOT installed —
                # the user opts in via Settings → Modules.
                conn.execute(
                    "INSERT INTO modules (id, name, icon, description, version, color, nav_path, enabled, installed, core) VALUES (?,?,?,?,?,?,?,0,0,?)",
                    (m["id"], m.get("name"), m.get("icon"), m.get("description"),
                     m.get("version"), m.get("color"), m.get("nav_path"), core)
                )
        conn.commit()
    finally:
        conn.close()


def get_active_ids() -> set[str]:
    """Modules that should actually run: installed AND enabled."""
    conn = get_db()
    try:
        rows = conn.execute("SELECT id FROM modules WHERE installed=1 AND enabled=1").fetchall()
        return {r["id"] for r in rows}
    finally:
        conn.close()


# ── router loading ────────────────────────────────────────────────────────────
# module ids whose routers are already registered on the app this process —
# guards against double-registration on hot-load / re-enable
_LOADED_ROUTERS: set[str] = set()


def _load_one(app: FastAPI, m: dict):
    """Register a single discovered module's routers on the app (see the package
    note in load_module_routers for why we load from file under a unique name)."""
    module_path = Path(m["_path"])
    # keep the module root importable for any module-local helper imports
    if str(module_path) not in sys.path:
        sys.path.insert(0, str(module_path))
    for dotpath in m.get("api_routers", []):
        rel  = dotpath.replace(".", "/") + ".py"
        file = module_path / rel
        if not file.exists():
            print(f"[modules] {m['id']}: router file not found ({rel})")
            continue
        unique = f"thrive_mod_{m['id']}_{dotpath.replace('.', '_')}"
        try:
            spec = importlib.util.spec_from_file_location(unique, file)
            mod  = importlib.util.module_from_spec(spec)
            sys.modules[unique] = mod
            spec.loader.exec_module(mod)
            if hasattr(mod, "router"):
                app.include_router(mod.router)
                print(f"[modules] loaded {m['id']} → {dotpath}")
            else:
                print(f"[modules] {dotpath} has no 'router' attribute")
        except Exception as e:
            print(f"[modules] failed to load {dotpath}: {e}")
    _LOADED_ROUTERS.add(m["id"])


def load_module_routers(app: FastAPI, discovered: list[dict], active_ids: set[str]):
    """Dynamically import and register each active module's API routers.

    Each `api_routers` entry is a dotted path *relative to the module root*
    (e.g. "api.routers.vehicles" → <module>/api/routers/vehicles.py). We load it
    straight from its file under a unique synthetic module name rather than via
    `importlib.import_module`, because every module uses the same `api.routers.*`
    package path — importing them as real packages makes the first-loaded module
    shadow the rest (the top-level `api` package binds to one module's dir).
    Routers stay free to `from routers.auth import …` since the base app dir is
    already on sys.path.
    """
    for m in discovered:
        if m["id"] not in active_ids:
            print(f"[modules] {m['id']} not active — skipping")
            continue
        _load_one(app, m)


def hot_load_module(app: FastAPI, module_id: str) -> bool:
    """Register a module's routers at runtime (called on enable/install) so it
    works immediately — no API restart. No-op if already loaded this process.
    FastAPI matches routes per-request, so a runtime include_router takes effect
    at once. Removing routes on disable isn't supported, so a disabled module's
    routes just go dormant (the UI gates it off) until the next restart."""
    if module_id in _LOADED_ROUTERS:
        return True
    m = next((x for x in discover_modules() if x["id"] == module_id), None)
    if not m:
        return False
    _load_one(app, m)
    app.openapi_schema = None   # regenerate the schema with the new routes
    return True


# ── public api ────────────────────────────────────────────────────────────────
def list_modules() -> list[dict]:
    """Return all registered modules with enabled state — for the frontend.
    `icon`/`color` are the effective values (user override if set, else the
    module.json default, also exposed as `icon_default`/`color_default`)."""
    conn = get_db()
    try:
        rows = [dict(r) for r in conn.execute("SELECT * FROM modules ORDER BY id").fetchall()]
        for d in rows:
            d["icon_default"]  = d.get("icon")
            d["color_default"] = d.get("color")
            if d.get("icon_override"):  d["icon"]  = d["icon_override"]
            if d.get("color_override"): d["color"] = d["color_override"]
        return rows
    finally:
        conn.close()


# ── per-profile module access (#7 Phase B) ───────────────────────────────────
LEVELS = ("none", "view", "read", "write")
HOUSEHOLD_UID = 0   # the no-login Household identity's key in module_access

def viewer_levels(user) -> dict:
    """{module_id: level} for the current viewer across all registered modules.
    Admins get 'write' everywhere; everyone else is 'none' unless explicitly granted
    (Household keyed as user_id 0; a logged-in profile by its id)."""
    conn = get_db()
    try:
        ids = [r["id"] for r in conn.execute("SELECT id FROM modules").fetchall()]
        if user and user.get("role") == "admin":
            return {mid: "write" for mid in ids}
        prof = (user or {}).get("profile")
        key = prof["id"] if prof else HOUSEHOLD_UID        # no profile => Household
        granted = {r["module_id"]: r["level"] for r in conn.execute(
            "SELECT module_id, level FROM module_access WHERE user_id=?", (key,)).fetchall()}
        return {mid: granted.get(mid, "none") for mid in ids}
    finally:
        conn.close()

def list_modules_for(user) -> list[dict]:
    """list_modules() plus each module's `access` level for the current viewer."""
    levels = viewer_levels(user)
    rows = list_modules()
    for d in rows:
        d["access"] = levels.get(d["id"], "none")
    return rows

def permissions_matrix() -> dict:
    """Admin view: Household + every profile and its per-module level (unset = none)."""
    conn = get_db()
    try:
        mods = [r["id"] for r in conn.execute("SELECT id FROM modules ORDER BY id").fetchall()]
        subjects = [{"user_id": HOUSEHOLD_UID, "name": "Household"}] + \
                   [{"user_id": r["id"], "name": r["name"]} for r in
                    conn.execute("SELECT id, name FROM users ORDER BY id").fetchall()]
        grants = {}
        for r in conn.execute("SELECT user_id, module_id, level FROM module_access").fetchall():
            grants.setdefault(r["user_id"], {})[r["module_id"]] = r["level"]
        for s in subjects:
            g = grants.get(s["user_id"], {})
            s["access"] = {mid: g.get(mid, "none") for mid in mods}
        return {"modules": mods, "subjects": subjects}
    finally:
        conn.close()

def set_access(user_id: int, module_id: str, level: str) -> bool:
    if level not in LEVELS:
        return False
    conn = get_db()
    try:
        if level == "none":
            conn.execute("DELETE FROM module_access WHERE user_id=? AND module_id=?", (user_id, module_id))
        else:
            conn.execute(
                "INSERT INTO module_access (user_id, module_id, level) VALUES (?,?,?) "
                "ON CONFLICT(user_id, module_id) DO UPDATE SET level=excluded.level",
                (user_id, module_id, level))
        conn.commit()
        return True
    finally:
        conn.close()


def _set_module_field(module_id: str, column: str, value: str | None) -> bool:
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM modules WHERE id=?", (module_id,)).fetchone():
            return False
        val = (value or "").strip() or None   # blank -> clear override, revert to default
        conn.execute(f"UPDATE modules SET {column}=? WHERE id=?", (val, module_id))
        conn.commit()
        return True
    finally:
        conn.close()

def set_module_icon(module_id: str, icon: str | None) -> bool:
    return _set_module_field(module_id, "icon_override", icon)

def set_module_color(module_id: str, color: str | None) -> bool:
    return _set_module_field(module_id, "color_override", color)

def is_core_module(module_id: str) -> bool:
    """Core modules (e.g. users) are required for the platform and can't be disabled."""
    conn = get_db()
    try:
        row = conn.execute("SELECT core FROM modules WHERE id=?", (module_id,)).fetchone()
        return bool(row and row["core"])
    finally:
        conn.close()

def set_module_enabled(module_id: str, enabled: bool) -> bool:
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM modules WHERE id=?", (module_id,)).fetchone():
            return False
        conn.execute("UPDATE modules SET enabled=? WHERE id=?", (1 if enabled else 0, module_id))
        conn.commit()
        return True
    finally:
        conn.close()

def set_module_installed(module_id: str, installed: bool) -> bool:
    """Install (installed=1, enabled=1) or uninstall (installed=0, enabled=0)
    a module. Routers load/unload on the next API restart."""
    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM modules WHERE id=?", (module_id,)).fetchone():
            return False
        flag = 1 if installed else 0
        conn.execute("UPDATE modules SET installed=?, enabled=? WHERE id=?", (flag, flag, module_id))
        conn.commit()
        return True
    finally:
        conn.close()


# ── bootstrap ─────────────────────────────────────────────────────────────────
def bootstrap(app: FastAPI):
    """Call this from main.py on startup."""
    init_modules_table()
    init_app_config()
    discovered = discover_modules()
    sync_registry(discovered)
    active     = get_active_ids()
    load_module_routers(app, discovered, active)
    print(f"[modules] {len(discovered)} discovered, {len(active)} active")