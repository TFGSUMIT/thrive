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


@router.get("/channels")
async def channels():
    """Live channels joined with now-playing EPG, sorted by channel number."""
    base, key, uid = _jf()
    if not base or not key:
        return JSONResponse({"channels": [], "error": "TV not configured — set the Jellyfin url + api_key."})
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            cp = {"api_key": key, "userId": uid, "EnableImages": "true", "limit": 300}
            ch = (await client.get(f"{base}/LiveTv/Channels", params=cp)).json().get("Items", [])
            pp = {"api_key": key, "userId": uid, "isAiring": "true", "limit": 600}
            pr = (await client.get(f"{base}/LiveTv/Programs/Recommended", params=pp)).json().get("Items", [])
    except Exception as e:
        return JSONResponse({"channels": [], "error": str(e)})

    now = {}
    for p in pr:
        cid = p.get("ChannelId")
        if cid and cid not in now:
            now[cid] = {"name": p.get("Name"), "start": p.get("StartDate"), "end": p.get("EndDate")}

    out = [{
        "id": c.get("Id"),
        "number": c.get("ChannelNumber"),
        "name": c.get("Name"),
        "has_logo": bool((c.get("ImageTags") or {}).get("Primary")),
        "now": now.get(c.get("Id")),
    } for c in ch]
    out.sort(key=_chan_sort)
    return {"channels": out, "jellyfin_url": base}


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
