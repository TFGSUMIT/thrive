# =============================================================================
# routers/tv.py — tv module: a native LiveTV guide over Jellyfin.
#
# Jellyfin (+ Tvheadend) runs the OTA DVR; this proxies its LiveTV API so the
# browser never needs the Jellyfin API key (stays server-side): channel list
# joined with now-playing EPG, a logo passthrough, and HLS playback proxying
# for the guide's popup player (the full Jellyfin app stays as a launcher).
#
# Config (tv_config key/value, per-deployment, not committed): url, api_key,
# user_id. Feature-detect pattern like the chat/lmstudio modules.
# =============================================================================
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, parse_qs
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


# ── in-popup playback (#93) ───────────────────────────────────────────────────
# The guide popup plays the channel itself: /stream does Jellyfin's PlaybackInfo
# handshake server-side and hands the browser a playlist URL under /hls, which
# proxies playlist + segments with the api_key appended here — the key never
# reaches the browser. /stream/stop frees the tuner/transcode on popup close.

# what we ask Jellyfin to transcode to: HLS h264/aac — what hls.js plays
_HLS_PROFILE = {"DeviceProfile": {
    "MaxStreamingBitrate": 20_000_000,
    "TranscodingProfiles": [{"Container": "ts", "Type": "Video",
                             "VideoCodec": "h264", "AudioCodec": "aac", "Protocol": "hls"}],
    "DirectPlayProfiles": [{"Container": "mp4", "Type": "Video"}],
}}


@router.get("/stream/{channel_id}")
async def stream(channel_id: str):
    """PlaybackInfo handshake → proxied HLS playlist URL for the popup player."""
    base, key, uid = _jf()
    if not base or not key:
        return JSONResponse({"error": "TV not configured"}, status_code=503)
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            r = await client.post(f"{base}/Items/{channel_id}/PlaybackInfo",
                                  params={"api_key": key, "userId": uid, "AutoOpenLiveStream": "true"},
                                  json=_HLS_PROFILE)
            d = r.json()
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=502)
    ms = (d.get("MediaSources") or [{}])[0]
    tu = ms.get("TranscodingUrl")
    if not tu:
        return JSONResponse({"error": "Channel has no transcodable stream"}, status_code=502)
    device_id = (parse_qs(urlparse(tu).query).get("DeviceId") or [""])[0]
    # the browser plays through our proxy; TranscodingUrl starts with /videos/…
    return {"url": "/api/tv/hls" + tu,
            "play_session_id": d.get("PlaySessionId") or "",
            "device_id": device_id}


@router.get("/hls/{path:path}")
async def hls_proxy(path: str, request: Request):
    """Playlist/segment passthrough. Whitelisted to Jellyfin's /videos/ tree;
    strips any client-sent api_key and appends the real one server-side.
    Long read timeout: the FIRST child-playlist fetch blocks while Jellyfin
    tunes the channel and produces the first transcoded segments."""
    base, key, _ = _jf()
    if not base or not key or not path.lower().startswith("videos/"):
        return Response(status_code=404)
    params = [(k, v) for k, v in request.query_params.multi_items() if k.lower() != "api_key"]
    params.append(("api_key", key))
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=10.0, read=150.0, write=30.0, pool=10.0))
    try:
        req = client.build_request("GET", f"{base}/{path}", params=params)
        r = await client.send(req, stream=True)
    except Exception:
        await client.aclose()
        return Response(status_code=502)
    if r.status_code != 200:
        await r.aclose(); await client.aclose()
        return Response(status_code=r.status_code)
    ctype = r.headers.get("content-type", "")
    if path.endswith(".m3u8") or "mpegurl" in ctype:
        body = (await r.aread()).decode()
        await r.aclose(); await client.aclose()
        # relative URIs resolve under /api/tv/hls/… already; re-root absolute ones
        out = []
        for line in body.splitlines():
            if line.startswith("/"):
                line = "/api/tv/hls" + line
            elif 'URI="/' in line:
                line = line.replace('URI="/', 'URI="/api/tv/hls/')
            out.append(line)
        return Response("\n".join(out) + "\n", media_type="application/vnd.apple.mpegurl",
                        headers={"Cache-Control": "no-store"})

    async def gen():
        try:
            async for chunk in r.aiter_bytes(65536):
                yield chunk
        finally:
            await r.aclose(); await client.aclose()
    return StreamingResponse(gen(), media_type=ctype or "video/mp2t")


@router.post("/stream/stop")
async def stream_stop(device_id: str = "", play_session_id: str = ""):
    """Free the tuner/transcode when the popup closes (4 OTA tuners — be nice)."""
    base, key, _ = _jf()
    if not base or not key or not device_id:
        return {"ok": False}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            await client.delete(f"{base}/Videos/ActiveEncodings",
                                params={"api_key": key, "DeviceId": device_id,
                                        "PlaySessionId": play_session_id})
    except Exception:
        pass
    return {"ok": True}


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
