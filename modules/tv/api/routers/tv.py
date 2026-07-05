# =============================================================================
# routers/tv.py — tv module: a native LiveTV guide over Jellyfin.
#
# Jellyfin (+ Tvheadend) runs the OTA DVR; this proxies its LiveTV API so the
# browser never needs the Jellyfin API key (stays server-side): channel list
# joined with now-playing EPG, plus a logo passthrough. Playback punts to the
# full Jellyfin app (a launcher in the UI) — it handles transcoding/codecs.
#
# Config (tv_config key/value, per-deployment, not committed): url, api_key,
# user_id. Feature-detect pattern like the chat/lmstudio modules.
# =============================================================================
from fastapi import APIRouter
from fastapi.responses import JSONResponse, Response
from datetime import datetime, timezone, timedelta
import os
import httpx

from routers.auth import get_db

router = APIRouter(prefix="/tv", tags=["tv"])


def init_db():
    conn = get_db()
    try:
        conn.execute("CREATE TABLE IF NOT EXISTS tv_config (key TEXT PRIMARY KEY, value TEXT)")
        conn.commit()
    finally:
        conn.close()


init_db()


def _cfg(key: str, default: str = "") -> str:
    try:
        conn = get_db()
        try:
            r = conn.execute("SELECT value FROM tv_config WHERE key=?", (key,)).fetchone()
            if r and r[0]:
                return r[0]
        finally:
            conn.close()
    except Exception:
        pass
    return os.environ.get(f"JELLYFIN_{key.upper()}", default)


def _jf():
    return _cfg("url").rstrip("/"), _cfg("api_key"), _cfg("user_id")


def _chan_sort(x):
    try:
        return [int(n) for n in (x.get("number") or "0").split(".")]
    except Exception:
        return [9999]


def _prog(p):
    """A trimmed program dict for the guide grid (name + airing window)."""
    return {"name": p.get("Name"), "start": p.get("StartDate"), "end": p.get("EndDate")}


# how far forward the guide grid can scroll
GUIDE_HOURS = 12


@router.get("/channels")
async def channels():
    """Live channels each with their forward EPG (now → +12h) for the guide grid."""
    base, key, uid = _jf()
    if not base or not key:
        return JSONResponse({"channels": [], "error": "TV not configured — set the Jellyfin url + api_key."})
    now_dt = datetime.now(timezone.utc)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            cp = {"api_key": key, "userId": uid, "EnableImages": "true", "limit": 300}
            ch = (await client.get(f"{base}/LiveTv/Channels", params=cp)).json().get("Items", [])
            # every program still airing between now and +12h, start-ascending, so
            # each channel's list is already in timeline order for the grid.
            gp = {"api_key": key, "userId": uid,
                  "MinEndDate": now_dt.isoformat(), "MaxStartDate": (now_dt + timedelta(hours=GUIDE_HOURS)).isoformat(),
                  "sortBy": "StartDate", "sortOrder": "Ascending", "limit": 5000}
            pr = (await client.get(f"{base}/LiveTv/Programs", params=gp)).json().get("Items", [])
    except Exception as e:
        return JSONResponse({"channels": [], "error": str(e)})

    by_chan = {}
    for p in pr:
        cid = p.get("ChannelId")
        if cid:
            by_chan.setdefault(cid, []).append(_prog(p))

    out = [{
        "id": c.get("Id"),
        "number": c.get("ChannelNumber"),
        "name": c.get("Name"),
        "has_logo": bool((c.get("ImageTags") or {}).get("Primary")),
        "programs": by_chan.get(c.get("Id"), []),
    } for c in ch]
    out.sort(key=_chan_sort)
    # web_url = the public https Jellyfin (e.g. tv.nerfarrow.com) the browser
    # embeds/launches; falls back to the LAN base for http/LAN access.
    # server_now lets the grid anchor "now" to the server clock, not the browser's.
    return {"channels": out, "jellyfin_url": _cfg("web_url") or base,
            "server_now": now_dt.isoformat(), "guide_hours": GUIDE_HOURS}


@router.get("/logo/{channel_id}")
async def logo(channel_id: str):
    """Proxy a channel logo from Jellyfin so the api_key stays server-side."""
    base, key, _ = _jf()
    if not base or not key:
        return Response(status_code=404)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{base}/Items/{channel_id}/Images/Primary", params={"api_key": key})
            if r.status_code != 200:
                return Response(status_code=404)
            return Response(content=r.content, media_type=r.headers.get("content-type", "image/png"),
                            headers={"Cache-Control": "public, max-age=86400"})
    except Exception:
        return Response(status_code=404)
