# =============================================================================
# routers/steam.py — Steam module: household game libraries
# thrive module `steam`
#
# Library dashboard over the Steam Web API: each household profile (the core
# `users` table) can link a Steam account; the page then shows that account's
# owned games + playtime, recently played, and live presence. Config is one
# Web API key (https://steamcommunity.com/dev/apikey) set in Settings → Steam.
# Steam profiles must have "Game details" public for the library calls to
# return anything — a private profile comes back empty and is flagged as such.
#
# Self-contained per the module loader:
#   • reuses the platform DB helper (shared thrive.db)
#   • owns `steam_config` (key/value) and `steam_links` (user_id → steamid)
#   • reads the core `users` table (profiles) for the link roster
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import re, time
import httpx

from routers.auth import get_db, current_profile_id
from crypto import get_secret   # personal-data platform: per-profile Steam login (Connections module)

router = APIRouter(prefix="/steam", tags=["steam"])

STEAM_API = "https://api.steampowered.com"


# ── db init ──────────────────────────────────────────────────────────────────
def init_db():
    conn = get_db()
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS steam_config (
                key        TEXT PRIMARY KEY,
                value      TEXT,
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """)
        # one Steam account per household profile; persona/avatar are a snapshot
        # taken at link time (display fallback), live data comes from the API
        conn.execute("""
            CREATE TABLE IF NOT EXISTS steam_links (
                user_id   INTEGER PRIMARY KEY,
                steamid   TEXT NOT NULL,
                persona   TEXT,
                avatar    TEXT,
                linked_at TEXT DEFAULT (datetime('now'))
            )
        """)
        conn.commit()
    finally:
        conn.close()

init_db()


# ── config helpers ────────────────────────────────────────────────────────────
def get_cfg(key: str, default: str = "") -> str:
    conn = get_db()
    try:
        row = conn.execute("SELECT value FROM steam_config WHERE key=?", (key,)).fetchone()
    finally:
        conn.close()
    return row["value"] if row is not None and row["value"] is not None else default

def set_cfg(key: str, value: str):
    conn = get_db()
    try:
        conn.execute(
            """INSERT INTO steam_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')""",
            (key, value)
        )
        conn.commit()
    finally:
        conn.close()

def require_key() -> str:
    key = get_cfg("api_key")
    if not key:
        raise HTTPException(status_code=400, detail="No Steam API key — add one in Settings → Steam")
    return key


# ── Steam Web API client (with a small in-memory cache) ──────────────────────
# Steam allows 100k calls/day but a library fetch is heavy-ish; cache GETs for
# a few minutes keyed on path+params. ttl=0 bypasses the cache (writes/lookups
# that must be fresh).
_cache: dict = {}

async def steam_get(path: str, params: dict, ttl: int = 300):
    ck = (path, tuple(sorted(params.items())))
    now = time.time()
    if ttl > 0 and ck in _cache and now - _cache[ck][0] < ttl:
        return _cache[ck][1]
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(f"{STEAM_API}{path}", params=params)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Steam unreachable: {e}")
    if r.status_code in (401, 403):
        raise HTTPException(status_code=502, detail="Steam rejected the API key — check Settings → Steam")
    if r.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Steam HTTP {r.status_code}")
    data = r.json()
    if ttl > 0:
        _cache[ck] = (now, data)
    return data


PERSONA_STATES = ["offline", "online", "busy", "away", "snooze", "looking to trade", "looking to play"]

def _summary(p: dict) -> dict:
    """Trim a GetPlayerSummaries player record to what the UI shows."""
    return {
        "steamid":    p.get("steamid"),
        "persona":    p.get("personaname"),
        "avatar":     p.get("avatarfull") or p.get("avatarmedium") or p.get("avatar"),
        "state":      PERSONA_STATES[p["personastate"]] if p.get("personastate", 0) < len(PERSONA_STATES) else "online",
        "in_game":    p.get("gameextrainfo"),   # name of the game being played right now, if any
        "last_online": p.get("lastlogoff"),     # unix epoch
        "url":        p.get("profileurl"),
    }


# ── schemas ──────────────────────────────────────────────────────────────────
class ConfigSet(BaseModel):
    key:   str
    value: str

class LinkBody(BaseModel):
    user_id: int
    steam:   str   # steamid64, vanity name, or a full steamcommunity.com profile URL


# ── config routes ────────────────────────────────────────────────────────────
@router.get("/config")
def get_config():
    """Never returns the key itself — just whether one is set, plus a hint."""
    key = get_cfg("api_key")
    return {"api_key_set": bool(key), "api_key_hint": f"…{key[-4:]}" if key else None}

@router.post("/config")
def post_config(item: ConfigSet):
    if item.key != "api_key":
        raise HTTPException(status_code=400, detail="Unknown config key")
    set_cfg(item.key, item.value.strip())
    _cache.clear()
    return {"ok": True}


# ── profile ↔ steam account links ────────────────────────────────────────────
@router.get("/links")
def list_links():
    """Every household profile, with its Steam link if any — the roster the
    Settings panel manages and the page builds its profile picker from."""
    conn = get_db()
    try:
        rows = conn.execute(
            """SELECT u.id AS user_id, u.name, u.avatar AS profile_avatar, u.color,
                      l.steamid, l.persona, l.avatar AS steam_avatar
               FROM users u LEFT JOIN steam_links l ON l.user_id = u.id
               ORDER BY u.id"""
        ).fetchall()
    finally:
        conn.close()
    return [dict(r) for r in rows]


async def resolve_steamid(raw: str, key: str) -> str:
    """Accepts a bare steamid64, a vanity name, or either form of profile URL."""
    s = raw.strip().rstrip("/")
    m = re.search(r"/profiles/(\d{17})$", s) or re.fullmatch(r"(\d{17})", s)
    if m:
        return m.group(1)
    mv = re.search(r"/id/([^/]+)$", s)
    vanity = mv.group(1) if mv else s
    data = await steam_get("/ISteamUser/ResolveVanityURL/v1/", {"key": key, "vanityurl": vanity}, ttl=0)
    resp = data.get("response", {})
    if resp.get("success") != 1:
        raise HTTPException(status_code=404, detail=f"Steam couldn't resolve '{vanity}' — try the steamid64 or full profile URL")
    return resp["steamid"]


@router.post("/links")
async def link_profile(body: LinkBody):
    key = require_key()
    steamid = await resolve_steamid(body.steam, key)

    # verify the account exists + snapshot its persona/avatar for the roster
    data = await steam_get("/ISteamUser/GetPlayerSummaries/v2/", {"key": key, "steamids": steamid}, ttl=0)
    players = data.get("response", {}).get("players", [])
    if not players:
        raise HTTPException(status_code=404, detail="No Steam account with that id")
    p = _summary(players[0])

    conn = get_db()
    try:
        if not conn.execute("SELECT id FROM users WHERE id=?", (body.user_id,)).fetchone():
            raise HTTPException(status_code=404, detail="No such profile")
        conn.execute(
            """INSERT INTO steam_links (user_id, steamid, persona, avatar, linked_at)
               VALUES (?, ?, ?, ?, datetime('now'))
               ON CONFLICT(user_id) DO UPDATE SET steamid=excluded.steamid,
                   persona=excluded.persona, avatar=excluded.avatar, linked_at=datetime('now')""",
            (body.user_id, steamid, p["persona"], p["avatar"])
        )
        conn.commit()
    finally:
        conn.close()
    return {"ok": True, "steamid": steamid, "persona": p["persona"]}


@router.delete("/links/{user_id}")
def unlink_profile(user_id: int):
    conn = get_db()
    try:
        conn.execute("DELETE FROM steam_links WHERE user_id=?", (user_id,))
        conn.commit()
    finally:
        conn.close()
    return {"ok": True}


# ── library ──────────────────────────────────────────────────────────────────
def _link_for(user_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT steamid FROM steam_links WHERE user_id=?", (user_id,)).fetchone()
    finally:
        conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="Profile has no Steam account linked")
    return row["steamid"]


async def _fetch_library(key: str, sid: str):
    """Fetch + shape one Steam account's dashboard payload: live presence, owned
    library with playtime, and the last-2-weeks recently-played list. A private
    profile comes back with empty games and `private: true`. Shared by
    /library/{user_id} (steam_links) and /my-library (personal connection)."""
    sm     = await steam_get("/ISteamUser/GetPlayerSummaries/v2/", {"key": key, "steamids": sid}, ttl=60)
    owned  = await steam_get("/IPlayerService/GetOwnedGames/v1/",
                             {"key": key, "steamid": sid, "include_appinfo": 1, "include_played_free_games": 1})
    recent = await steam_get("/IPlayerService/GetRecentlyPlayedGames/v1/", {"key": key, "steamid": sid}, ttl=60)

    players = sm.get("response", {}).get("players", [])
    oresp   = owned.get("response", {})
    games = [{
        "appid":       g["appid"],
        "name":        g.get("name") or str(g["appid"]),
        "playtime":    g.get("playtime_forever", 0),        # minutes, all time
        "last_played": g.get("rtime_last_played") or None,  # unix epoch, 0 = never
        "icon":        g.get("img_icon_url") or None,
    } for g in oresp.get("games", [])]

    return {
        "profile": _summary(players[0]) if players else None,
        "private": "games" not in oresp,   # Steam omits the key entirely for private profiles
        "game_count": oresp.get("game_count", len(games)),
        "total_playtime": sum(g["playtime"] for g in games),
        "games": games,
        "recent": [{
            "appid":    g["appid"],
            "name":     g.get("name") or str(g["appid"]),
            "two_weeks": g.get("playtime_2weeks", 0),   # minutes
            "playtime": g.get("playtime_forever", 0),
            "icon":     g.get("img_icon_url") or None,
        } for g in recent.get("response", {}).get("games", [])],
    }


@router.get("/library/{user_id}")
async def library(user_id: int):
    """The dashboard payload for one linked profile (steam_links)."""
    return await _fetch_library(require_key(), _link_for(user_id))


@router.get("/my-library")
async def my_library(request: Request):
    """The SIGNED-IN profile's Steam library, identified by their personal Steam
    CONNECTION (Settings → Connections) rather than steam_links — the personal-data
    platform adopter. The encrypted secret holds {steam_id, api_key?}; the key
    falls back to the shared household key (Settings → Steam) when not carried on
    the connection. So each person sees THEIR library from THEIR own linked login."""
    me = current_profile_id(request)
    if me is None:
        raise HTTPException(status_code=400, detail="Sign in with a profile")
    conn = get_db()
    try:
        secret = get_secret(conn, me, "steam")
    finally:
        conn.close()
    if not secret or not secret.get("steam_id"):
        raise HTTPException(status_code=404, detail="No Steam connection — add one in Settings → Connections")
    key = secret.get("api_key") or get_cfg("api_key")
    if not key:
        raise HTTPException(status_code=400, detail="No Steam API key — add it to your connection or in Settings → Steam")
    data = await _fetch_library(key, str(secret["steam_id"]).strip())
    data["source"] = "connection"
    return data


@router.get("/overview")
async def overview():
    """Live presence for every linked account in one batched call — the page's
    profile picker uses it for online/in-game dots."""
    links = list_links()
    sids = [l["steamid"] for l in links if l["steamid"]]
    if not sids:
        return {"players": {}}
    key = require_key()
    data = await steam_get("/ISteamUser/GetPlayerSummaries/v2/", {"key": key, "steamids": ",".join(sids)}, ttl=60)
    players = {p["steamid"]: _summary(p) for p in data.get("response", {}).get("players", [])}
    return {"players": players}
