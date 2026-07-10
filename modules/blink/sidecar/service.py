"""
blink sidecar service — the blinkvault capture engine, headless.

Ported from nerfBase /opt/blinkvault app.py (the working rig): motion-triggered
MP4 clips + manual capture + 2s live snapshots off a Blink camera's liveview,
via patched blinkpy. The terminal-prompt auth is replaced with API endpoints
(login → optional 2FA PIN → saved creds.json) so the thrive UI can drive it.
Consumed only by the thrive API's /blink proxy on the internal network.
"""

import asyncio
import collections
import json
import logging
import ssl
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import numpy as np

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response

from blinkpy import api
from blinkpy.auth import Auth, BlinkTwoFARequiredError, LoginError
from blinkpy.blinkpy import Blink
from blinkpy.livestream import BlinkLiveStream

logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("blink-sidecar")

BASE_DIR    = Path("/data")
CREDS_FILE  = BASE_DIR / "creds.json"
CONFIG_FILE = BASE_DIR / "capture_config.json"
CLIPS_DIR   = BASE_DIR / "clips"
CLIPS_DIR.mkdir(parents=True, exist_ok=True)

PRE_ROLL_SECONDS = 30           # seconds of footage before motion to include

DEFAULT_CONFIG = {
    "clip_duration": 30,
    "camera_name": "",          # blank = first camera found
    "motion_threshold": 10,     # mean pixel diff (0–255); lower = more sensitive
    "cooldown": 60,             # seconds between motion triggers
}

# Frame size for motion analysis — small = fast, lower CPU
ANALYSIS_W, ANALYSIS_H = 320, 180
ANALYSIS_FPS = 2


def load_config() -> dict:
    if CONFIG_FILE.exists():
        return {**DEFAULT_CONFIG, **json.loads(CONFIG_FILE.read_text())}
    return dict(DEFAULT_CONFIG)


def save_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


# ---------------------------------------------------------------------------
# Resilient livestream (fixes blinkpy partial-read + poll-fragility bugs)
# ---------------------------------------------------------------------------

class ResilientLiveStream(BlinkLiveStream):
    def __init__(self, camera, response):
        super().__init__(camera, response)
        self.on_data = None  # optional callback(bytes) called for every raw MPEG-TS chunk

    async def recv(self):
        try:
            while not self.target_reader.at_eof():
                try:
                    header = await self.target_reader.readexactly(9)
                except asyncio.IncompleteReadError:
                    break
                msgtype = header[0]
                payload_length = int.from_bytes(header[5:9], byteorder="big")
                if payload_length <= 0:
                    continue
                try:
                    data = await self.target_reader.readexactly(payload_length)
                except asyncio.IncompleteReadError:
                    break
                if msgtype != 0x00 or data[0] != 0x47:
                    continue
                if self.on_data:
                    self.on_data(data)
                for writer in list(self.clients):
                    if not writer.is_closing():
                        writer.write(data)
                        await writer.drain()
                await asyncio.sleep(0)
        except ssl.SSLError as e:
            if e.reason != "APPLICATION_DATA_AFTER_CLOSE_NOTIFY":
                pass
        except Exception:
            pass
        finally:
            self.target_writer.close()

    async def poll(self):
        failures = 0
        try:
            while not self.target_reader.at_eof():
                await asyncio.sleep(self.polling_interval)
                try:
                    response = await api.request_command_status(
                        self.camera.sync.blink,
                        self.camera.network_id,
                        self.command_id,
                    )
                    failures = 0
                    for cmd in response.get("commands", []):
                        if cmd.get("id") == self.command_id:
                            if cmd.get("state_condition") not in ("new", "running"):
                                return
                except Exception:
                    failures += 1
                    if failures >= 5:
                        return
        finally:
            try:
                await api.request_command_done(
                    self.camera.sync.blink,
                    self.camera.network_id,
                    self.command_id,
                )
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Blink auth — API-driven (login → optional 2FA → saved creds.json)
# ---------------------------------------------------------------------------

def load_creds() -> dict:
    if CREDS_FILE.exists():
        return json.loads(CREDS_FILE.read_text())
    return {}


def save_creds(auth: Auth) -> None:
    CREDS_FILE.write_text(json.dumps(auth.login_attributes, indent=2))


async def _close_blink(blink: Blink) -> None:
    if blink and blink.auth and getattr(blink.auth, "session", None):
        try:
            await blink.auth.session.close()
        except Exception:
            pass


async def authenticate(blink: Blink) -> None:
    """Daemon-side auth from saved creds only — the UI handles login/2FA."""
    creds = load_creds()
    if not creds:
        raise RuntimeError("Not logged in — add Blink credentials in the module first")
    blink.auth = Auth(creds, no_prompt=True)
    # Blink.start() returns False on auth failure instead of raising — check it,
    # and confirm a real token landed (the original blinkvault never did, which
    # made failed logins look like empty accounts).
    ok = await blink.start()
    if ok is False or not getattr(blink.auth, "token", None):
        raise RuntimeError("Blink login failed (see blinkpy log for status/body)")
    save_creds(blink.auth)   # persist refreshed tokens


def find_camera(blink: Blink, name: str):
    cameras = {}
    for sync in blink.sync.values():
        cameras.update(sync.cameras)
    if not cameras:
        return None, None
    if name:
        cam = cameras.get(name)
        return (name, cam) if cam else (None, None)
    cam_name, cam = next(iter(cameras.items()))
    return cam_name, cam


# ---------------------------------------------------------------------------
# Livestream / clip engine (unchanged from the working rig)
# ---------------------------------------------------------------------------

async def init_livestream(camera) -> ResilientLiveStream:
    response = await api.request_camera_liveview(
        camera.sync.blink,
        camera.sync.network_id,
        camera.camera_id,
        camera_type=camera.camera_type,
    )
    if "server" not in response:
        raise RuntimeError(f"Liveview API returned no server URL: {response}")
    if not response["server"].startswith("immis://"):
        raise RuntimeError(f"Unsupported stream protocol: {response['server']}")
    return ResilientLiveStream(camera, response)


class Daemon:
    def __init__(self):
        self.running = False
        self.recording = False
        self.last_event: str | None = None
        self.log: list[str] = []
        self._task: asyncio.Task | None = None
        self._blink: Blink | None = None
        self._ts_buf: collections.deque | None = None
        self._proxy_url: str | None = None
        self._latest_jpeg: bytes | None = None
        self.cameras: list[str] = []

    def _emit(self, msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        entry = f"[{ts}] {msg}"
        log.info(msg)
        self.log.insert(0, entry)
        if len(self.log) > 50:
            self.log.pop()

    async def start(self) -> None:
        if self.running:
            return
        self.running = True
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self.running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        await _close_blink(self._blink)
        self._blink = None
        self._emit("Daemon stopped")

    async def _run(self) -> None:
        self._emit("Starting — authenticating with Blink...")
        try:
            self._blink = Blink(motion_interval=0, refresh_rate=30)
            await authenticate(self._blink)
        except Exception as e:
            self._emit(f"Auth failed: {e}")
            self.running = False
            return

        cfg = load_config()
        all_cams = {}
        for sync in self._blink.sync.values():
            all_cams.update(sync.cameras)
        self.cameras = list(all_cams)
        cam_name, camera = find_camera(self._blink, cfg.get("camera_name", ""))
        if camera is None:
            # dump identity + the raw homescreen so "account empty" vs "wrong
            # account/region" vs "unparsed device type" is diagnosable from the
            # activity log without extra logins
            a = self._blink.auth
            self._emit(f"auth: account_id={getattr(a,'account_id',None)} "
                       f"region={getattr(a,'region_id',None)} host={getattr(a,'host',None)}")
            hs = getattr(self._blink, "homescreen", None)
            self._emit(f"No camera found. Raw homescreen: {repr(hs)[:600]}")
            self.running = False
            return

        self._emit(f"Monitoring: {cam_name} — local motion detection active")

        try:
            consecutive_short = 0
            while self.running:
                stream_start = time.monotonic()
                try:
                    await self._stream_and_detect(camera, cam_name)
                    duration = time.monotonic() - stream_start
                    if duration < 15:
                        consecutive_short += 1
                        delay = min(10 * consecutive_short, 60)
                        self._emit(f"Stream ended quickly ({duration:.0f}s) — backing off {delay}s")
                        await asyncio.sleep(delay)
                    else:
                        consecutive_short = 0
                        await asyncio.sleep(3)
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    consecutive_short += 1
                    delay = 30 if "busy" in str(e).lower() or "307" in str(e) else min(10 * consecutive_short, 60)
                    self._emit(f"Stream error ({type(e).__name__}): {e} — reconnecting in {delay}s")
                    await asyncio.sleep(delay)
                    cfg = load_config()
                    _, camera = find_camera(self._blink, cfg.get("camera_name", "") or cam_name)
                    if camera is None:
                        self._emit("Camera lost, stopping.")
                        self.running = False
                        return

        except asyncio.CancelledError:
            self._emit("Daemon cancelled (graceful stop)")
            raise
        except BaseException as e:
            self._emit(f"Daemon crashed: {type(e).__name__}: {e}")
            self.running = False
            raise

    async def _stream_and_detect(self, camera, cam_name: str) -> None:
        ls = await init_livestream(camera)
        await ls.start(host="127.0.0.1", port=0)
        proxy_url = ls.url
        feed_task = asyncio.create_task(ls.feed())
        self._proxy_url = proxy_url
        asyncio.create_task(self._snapshot_loop(proxy_url))
        await asyncio.sleep(2)
        self._emit("Stream open — monitoring for motion")

        ts_buf: collections.deque = collections.deque()
        self._ts_buf = ts_buf

        def _on_data(chunk: bytes) -> None:
            now = time.monotonic()
            ts_buf.append((now, chunk))
            if not self.recording:
                cutoff = now - PRE_ROLL_SECONDS - 2
                while ts_buf and ts_buf[0][0] < cutoff:
                    ts_buf.popleft()

        ls.on_data = _on_data

        frame_size = ANALYSIS_W * ANALYSIS_H
        analysis_proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error",
            "-fflags", "+nobuffer+discardcorrupt",
            "-analyzeduration", "2000000",
            "-probesize", "1000000",
            "-i", proxy_url,
            "-vf", f"scale={ANALYSIS_W}:{ANALYSIS_H},fps={ANALYSIS_FPS}",
            "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )

        prev_frame: np.ndarray | None = None
        last_trigger = 0.0
        frame_count = 0

        try:
            while self.running:
                cfg = load_config()
                data = await analysis_proc.stdout.readexactly(frame_size)
                frame = np.frombuffer(data, dtype=np.uint8)
                frame_count += 1

                if prev_frame is not None and frame_count > ANALYSIS_FPS * 2:
                    diff = float(np.mean(np.abs(frame.astype(np.int16) - prev_frame.astype(np.int16))))
                    now = time.monotonic()
                    if (
                        diff > cfg.get("motion_threshold", 10)
                        and (now - last_trigger) > cfg.get("cooldown", 60)
                        and not self.recording
                    ):
                        last_trigger = now
                        self.recording = True
                        motion_ts = now
                        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
                        out_path = CLIPS_DIR / f"motion_{ts}.mp4"
                        self._emit(f"Motion! diff={diff:.1f} — saving {cfg['clip_duration']}s: {out_path.name}")
                        self.last_event = ts
                        asyncio.create_task(
                            self._save_clip_from_buffer(ts_buf, motion_ts, cfg["clip_duration"], out_path)
                        )

                prev_frame = frame

        except asyncio.IncompleteReadError:
            self._emit("Stream ended — will reconnect")
        finally:
            ls.on_data = None
            self._ts_buf = None
            self._proxy_url = None
            self._latest_jpeg = None
            try:
                analysis_proc.kill()
                await analysis_proc.wait()
            except Exception:
                pass
            feed_task.cancel()
            try:
                await feed_task
            except asyncio.CancelledError:
                pass
            ls.stop()

    async def _snapshot_loop(self, proxy_url: str) -> None:
        while self._proxy_url == proxy_url:
            try:
                if self._ts_buf:
                    now = time.monotonic()
                    # 10s window ensures at least one keyframe is included
                    raw = b"".join(chunk for t, chunk in list(self._ts_buf) if t > now - 10)
                    if raw:
                        proc = await asyncio.create_subprocess_exec(
                            "ffmpeg", "-loglevel", "quiet",
                            "-f", "mpegts", "-i", "pipe:0",
                            "-vframes", "1", "-f", "image2pipe", "-vcodec", "mjpeg",
                            "pipe:1",
                            stdin=asyncio.subprocess.PIPE,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.DEVNULL,
                        )
                        stdout, _ = await asyncio.wait_for(
                            proc.communicate(input=raw), timeout=5.0
                        )
                        if stdout:
                            self._latest_jpeg = stdout
            except Exception as e:
                self._emit(f"Snapshot error: {e}")
            await asyncio.sleep(2)

    async def _save_clip_from_buffer(
        self, ts_buf: collections.deque, motion_ts: float, duration: int, out_path: Path
    ) -> None:
        try:
            await asyncio.sleep(duration + 1)

            pre_start = motion_ts - PRE_ROLL_SECONDS
            clip_end  = motion_ts + duration

            chunks = list(ts_buf)
            raw = b"".join(chunk for t, chunk in chunks if pre_start <= t <= clip_end)
            if not raw:
                self._emit(f"Buffer empty for {out_path.name}")
                return

            tmp = out_path.with_suffix(".tmp.ts")
            tmp.write_bytes(raw)

            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-loglevel", "error", "-y",
                "-fflags", "+genpts",
                "-i", str(tmp),
                "-c:v", "copy",
                "-c:a", "aac", "-ar", "16000",
                "-movflags", "+faststart",
                "-f", "mp4", str(out_path),
            )
            await proc.wait()
            tmp.unlink(missing_ok=True)

            if proc.returncode == 0 and out_path.exists() and out_path.stat().st_size > 0:
                self._emit(f"Saved: {out_path.name} ({len(raw)//1024} KB)")
            else:
                self._emit(f"Failed: {out_path.name}")
        except Exception as e:
            self._emit(f"Save error: {e}")
        finally:
            self.recording = False


daemon = Daemon()

# login awaiting a 2FA PIN keeps its Blink instance here until the PIN arrives
_pending: dict = {"blink": None}


# ---------------------------------------------------------------------------
# FastAPI app (no HTML — the thrive module UI is the front end)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("aiohttp.client").setLevel(logging.CRITICAL)
    # ERROR (not CRITICAL): blinkpy's "OAuth signin failed: status=… body=…"
    # error line is the only way to see WHY a login failed
    logging.getLogger("blinkpy").setLevel(logging.ERROR)
    watcher = asyncio.create_task(_event_watcher())
    yield
    watcher.cancel()
    await daemon.stop()

app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"ok": True}


@app.get("/auth/status")
async def auth_status():
    return {"authed": CREDS_FILE.exists(), "pending_2fa": _pending["blink"] is not None}


@app.post("/auth/login")
async def auth_login(request: Request):
    data = await request.json()
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="username and password required")
    if daemon.running:
        await daemon.stop()
    old = _pending["blink"]
    if old:
        _pending["blink"] = None
        await _close_blink(old)
    blink = Blink(motion_interval=0, refresh_rate=30)
    blink.auth = Auth({"username": username, "password": password}, no_prompt=True)
    try:
        ok = await blink.start()
    except BlinkTwoFARequiredError:
        _pending["blink"] = blink
        return {"ok": True, "pending_2fa": True}
    except LoginError as e:
        await _close_blink(blink)
        raise HTTPException(status_code=401, detail=f"Login failed: {e}")
    # start() returns False on failure rather than raising — treat as failure
    if ok is False or not getattr(blink.auth, "token", None):
        await _close_blink(blink)
        raise HTTPException(status_code=401, detail="Blink login failed (check the sidecar log)")
    save_creds(blink.auth)
    await _close_blink(blink)
    return {"ok": True, "authed": True}


@app.post("/auth/2fa")
async def auth_2fa(request: Request):
    data = await request.json()
    code = (data.get("code") or "").strip()
    blink = _pending["blink"]
    if blink is None:
        raise HTTPException(status_code=400, detail="No login awaiting a 2FA code")
    if not code:
        raise HTTPException(status_code=400, detail="code required")
    if not await blink.send_2fa_code(code):
        raise HTTPException(status_code=401, detail="2FA code rejected")
    save_creds(blink.auth)
    _pending["blink"] = None
    await _close_blink(blink)
    return {"ok": True, "authed": True}


@app.post("/auth/logout")
async def auth_logout():
    if daemon.running:
        await daemon.stop()
    if _browser["blink"] is not None:
        await _close_blink(_browser["blink"])
        _browser["blink"] = None
    CREDS_FILE.unlink(missing_ok=True)
    return {"ok": True}


@app.post("/daemon/start")
async def daemon_start():
    if not CREDS_FILE.exists():
        return JSONResponse({"ok": False, "error": "Not logged in"}, status_code=409)
    await daemon.start()
    return {"ok": True}


@app.post("/daemon/stop")
async def daemon_stop():
    await daemon.stop()
    return {"ok": True}


@app.post("/daemon/record")
async def daemon_record_now():
    if not daemon.running:
        return {"ok": False, "error": "Daemon not running"}
    if daemon.recording:
        return {"ok": False, "error": "Already recording"}
    if daemon._ts_buf is None:
        return {"ok": False, "error": "Stream not ready yet — wait a moment and try again"}
    cfg = load_config()
    daemon.recording = True
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = CLIPS_DIR / f"manual_{ts}.mp4"
    daemon._emit(f"Manual record — {cfg['clip_duration']}s: {out_path.name}")
    asyncio.create_task(
        daemon._save_clip_from_buffer(daemon._ts_buf, time.monotonic(), cfg["clip_duration"], out_path)
    )
    return {"ok": True}


@app.get("/status")
async def status():
    cfg = load_config()
    clips = sorted(CLIPS_DIR.glob("*.mp4"), key=lambda f: f.stat().st_mtime, reverse=True)
    clip_data = [{"name": f.name, "size": f.stat().st_size} for f in clips[:30]]
    return {
        "authed": CREDS_FILE.exists(),
        "pending_2fa": _pending["blink"] is not None,
        "running": daemon.running,
        "recording": daemon.recording,
        "last_event": daemon.last_event,
        "cameras": daemon.cameras,
        "log": daemon.log[:20],
        "clips": clip_data,
        "config": cfg,
    }


@app.get("/config")
async def get_config():
    return load_config()


@app.post("/config")
async def set_config(request: Request):
    data = await request.json()
    cfg = load_config()
    for key in ("clip_duration", "camera_name", "motion_threshold", "cooldown"):
        if key in data:
            cfg[key] = data[key]
    save_config(cfg)
    return {"ok": True, "config": cfg}


@app.get("/clips/{filename}")
async def serve_clip(filename: str):
    path = CLIPS_DIR / filename
    if "/" in filename or not path.exists() or path.suffix != ".mp4":
        return JSONResponse({"error": "not found"}, status_code=404)
    return FileResponse(str(path), media_type="video/mp4",
                        headers={"Accept-Ranges": "bytes"})


@app.delete("/clips/{filename}")
async def delete_clip(filename: str):
    path = CLIPS_DIR / filename
    if "/" not in filename and path.exists() and path.suffix == ".mp4":
        path.unlink()
    return {"ok": True}


@app.get("/snapshot.jpg")
async def snapshot():
    if daemon._latest_jpeg is None:
        raise HTTPException(status_code=503, detail="No snapshot available yet")
    return Response(content=daemon._latest_jpeg, media_type="image/jpeg",
                    headers={"Cache-Control": "no-store"})


# ── all-cameras browser (app-style home screen) ───────────────────────────────
# Latest cloud thumbnails for every camera on the account — not live video.
# Reuses the daemon's authed Blink when it's running; otherwise keeps one lazy
# standalone instance (Blink allows concurrent sessions, same as the phone app).
_browser: dict = {"blink": None, "refreshed": 0.0}


async def _browse_blink() -> Blink:
    if daemon.running and daemon._blink is not None:
        return daemon._blink
    if _browser["blink"] is not None:
        return _browser["blink"]
    blink = Blink(motion_interval=0, refresh_rate=30)
    await authenticate(blink)   # RuntimeError when not logged in / creds rejected
    _browser["blink"] = blink
    return blink


def _cameras_of(blink: Blink) -> dict:
    cams = {}
    for sync in blink.sync.values():
        cams.update(sync.cameras)
    return cams


async def _fresh_browse_blink() -> Blink:
    try:
        blink = await _browse_blink()
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    if time.monotonic() - _browser["refreshed"] > 30:
        try:
            await blink.refresh(force=True)
            _browser["refreshed"] = time.monotonic()
        except Exception as e:
            log.warning("homescreen refresh failed: %s", e)
    return blink


@app.get("/cameras")
async def cameras_list():
    blink = await _fresh_browse_blink()
    out = []
    for name, cam in _cameras_of(blink).items():
        a = cam.attributes
        out.append({
            "name":           name,
            "serial":         a.get("serial"),
            "battery":        a.get("battery"),
            "temperature":    a.get("temperature"),
            "wifi_strength":  a.get("wifi_strength"),
            "motion_enabled": a.get("motion_enabled"),
            "type":           getattr(cam, "camera_type", None),
            "event_ts":       _event_state["event_ts"].get(name),
            "event_active":   _event_wins(name),
        })
    return {"cameras": out}


@app.get("/cameras/{name}/thumb.jpg")
async def camera_thumb(name: str):
    # a newer motion/doorbell event frame beats the cloud thumbnail
    if _event_wins(name):
        return Response(content=_event_frame(name).read_bytes(),
                        media_type="image/jpeg",
                        headers={"Cache-Control": "private, max-age=30"})
    blink = await _fresh_browse_blink()
    cam = _cameras_of(blink).get(name)
    if cam is None:
        raise HTTPException(status_code=404, detail="No such camera")
    resp = await cam.get_media()
    if not resp or resp.status != 200:
        raise HTTPException(status_code=502, detail="Thumbnail fetch failed")
    data = await resp.read()
    return Response(content=data, media_type="image/jpeg",
                    headers={"Cache-Control": "private, max-age=30"})


@app.post("/cameras/{name}/snap")
async def camera_snap(name: str):
    blink = await _fresh_browse_blink()
    cam = _cameras_of(blink).get(name)
    if cam is None:
        raise HTTPException(status_code=404, detail="No such camera")
    await cam.snap_picture()          # ask the camera for a new thumbnail
    _browser["refreshed"] = 0.0       # force homescreen re-pull on next fetch
    _event_state["cloud_ts"][name] = time.time()   # fresh cloud thumb wins the card
    return {"ok": True}


# ── event-driven thumbnails ───────────────────────────────────────────────────
# Blink's own motion detection (and doorbell presses) already record a clip to
# the cloud; this watcher polls the homescreen (cloud only — never wakes a
# camera) and, when a camera has a NEW clip, extracts its first frame as the
# camera's card image. The locally-monitored camera (capture_config
# camera_name) is skipped — it only does anything when actively watched.
EVENT_THUMBS = BASE_DIR / "event_thumbs"
EVENT_POLL_SECONDS = 60
_event_state: dict = {"clips": {}, "event_ts": {}, "cloud_ts": {}}


def _event_frame(name: str) -> Path:
    return EVENT_THUMBS / f"{name}.jpg"


def _event_wins(name: str) -> bool:
    """The event frame is the card image iff it's newer than the cloud thumb."""
    ts = _event_state["event_ts"].get(name)
    return bool(ts and ts > _event_state["cloud_ts"].get(name, 0)
                and _event_frame(name).exists())


async def _extract_event_frame(cam, name: str) -> None:
    resp = await cam.get_video_clip()
    if not resp or resp.status != 200:
        return
    data = await resp.read()
    EVENT_THUMBS.mkdir(exist_ok=True)
    tmp = EVENT_THUMBS / f".{name}.mp4"
    tmp.write_bytes(data)
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-loglevel", "error", "-y", "-i", str(tmp),
        "-frames:v", "1", "-q:v", "4", str(_event_frame(name)))
    await proc.wait()
    tmp.unlink(missing_ok=True)
    if proc.returncode == 0:
        _event_state["event_ts"][name] = time.time()
        log.info("event frame updated: %s", name)


async def _event_watcher() -> None:
    while True:
        try:
            await asyncio.sleep(EVENT_POLL_SECONDS)
            if not CREDS_FILE.exists():
                continue
            blink = await _browse_blink()
            await blink.refresh(force=True)
            _browser["refreshed"] = time.monotonic()
            skip = (load_config().get("camera_name") or "").strip()
            for name, cam in _cameras_of(blink).items():
                if name == skip:
                    continue
                clip = getattr(cam, "clip", None)
                had_baseline = name in _event_state["clips"]
                if clip and clip != _event_state["clips"].get(name):
                    _event_state["clips"][name] = clip
                    if had_baseline:      # first poll just sets the baseline
                        await _extract_event_frame(cam, name)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            log.warning("event watcher: %s", e)


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8080, log_level="warning")
