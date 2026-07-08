# =============================================================================
# routers/blink.py — blink module: authed proxy to the blinkvault sidecar.
#
# The sidecar (thrive_blink, internal network only) runs the actual capture
# engine — patched blinkpy + ffmpeg. This router is the only way in: every
# endpoint requires a thrive session, JSON calls pass through, clips stream
# with Range support so <video> can seek. Blink account creds live in the
# sidecar's volume (trunk data/blink), never in the browser or this container.
# =============================================================================
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
import os
import httpx

from routers.auth import current_user_from_request

router = APIRouter(prefix="/blink", tags=["blink"])

SIDECAR = os.environ.get("BLINK_SIDECAR_URL", "http://thrive_blink:8080")


def _auth(request: Request):
    u = current_user_from_request(request)
    if not u:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return u


async def _passthrough(method: str, path: str, body=None, timeout: float = 30.0):
    """JSON in / JSON out to the sidecar; 503 with a hint when it's not running."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.request(method, f"{SIDECAR}{path}", json=body)
        return JSONResponse(r.json(), status_code=r.status_code)
    except httpx.HTTPError:
        return JSONResponse({"error": "blink sidecar unreachable — is the container up?"},
                            status_code=503)


@router.get("/status")
async def status(request: Request):
    _auth(request)
    return await _passthrough("GET", "/status")


@router.post("/daemon/{action}")
async def daemon_action(action: str, request: Request):
    _auth(request)
    if action not in ("start", "stop", "record"):
        raise HTTPException(status_code=404, detail="Unknown action")
    return await _passthrough("POST", f"/daemon/{action}")


@router.get("/config")
async def get_config(request: Request):
    _auth(request)
    return await _passthrough("GET", "/config")


@router.post("/config")
async def set_config(request: Request):
    _auth(request)
    return await _passthrough("POST", "/config", body=await request.json())


@router.get("/auth/status")
async def auth_status(request: Request):
    _auth(request)
    return await _passthrough("GET", "/auth/status")


@router.post("/auth/login")
async def auth_login(request: Request):
    _auth(request)
    # Blink login can be slow (cloud roundtrips)
    return await _passthrough("POST", "/auth/login", body=await request.json(), timeout=60.0)


@router.post("/auth/2fa")
async def auth_2fa(request: Request):
    _auth(request)
    return await _passthrough("POST", "/auth/2fa", body=await request.json(), timeout=60.0)


@router.post("/auth/logout")
async def auth_logout(request: Request):
    _auth(request)
    return await _passthrough("POST", "/auth/logout")


@router.get("/snapshot.jpg")
async def snapshot(request: Request):
    _auth(request)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(f"{SIDECAR}/snapshot.jpg")
        if r.status_code != 200:
            return Response(status_code=r.status_code)
        return Response(content=r.content, media_type="image/jpeg",
                        headers={"Cache-Control": "no-store"})
    except httpx.HTTPError:
        return Response(status_code=503)


@router.get("/clips/{filename}")
async def clip(filename: str, request: Request):
    """Stream a clip with Range passthrough so <video> can seek."""
    _auth(request)
    headers = {}
    if "range" in request.headers:
        headers["Range"] = request.headers["range"]
    client = httpx.AsyncClient(timeout=httpx.Timeout(connect=5.0, read=60.0, write=30.0, pool=5.0))
    try:
        req = client.build_request("GET", f"{SIDECAR}/clips/{filename}", headers=headers)
        r = await client.send(req, stream=True)
    except httpx.HTTPError:
        await client.aclose()
        return Response(status_code=503)
    if r.status_code not in (200, 206):
        await r.aclose(); await client.aclose()
        return Response(status_code=r.status_code)
    passthru = {k: v for k, v in r.headers.items()
                if k.lower() in ("content-range", "content-length", "accept-ranges")}

    async def gen():
        try:
            async for chunk in r.aiter_bytes(65536):
                yield chunk
        finally:
            await r.aclose(); await client.aclose()

    return StreamingResponse(gen(), status_code=r.status_code,
                             media_type="video/mp4", headers=passthru)


@router.delete("/clips/{filename}")
async def delete_clip(filename: str, request: Request):
    _auth(request)
    return await _passthrough("DELETE", f"/clips/{filename}")
