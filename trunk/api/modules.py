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