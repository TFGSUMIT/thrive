# blink sidecar — the blinkvault engine (ported from nerfBase /opt/blinkvault)
# as a container: blinkpy + ffmpeg + the headless capture service.
# History: the base rig ran 0.25.5 + manual patches (liveview v5→v6, app_version
# 55.1, User-Agent). Upstream 0.25.7 (2026-06-27) upstreamed the v6 liveview and
# reworked the OAuth signin for Blink's newer contract (202+JSON 2FA state), so
# we run it stock; the old patched files are kept in patches/ for reference only.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir blinkpy==0.25.7 numpy fastapi uvicorn

COPY service.py /app/service.py

# creds.json, capture_config.json and clips/ live on the mounted volume
WORKDIR /data
EXPOSE 8080
CMD ["python", "/app/service.py"]
