# blink sidecar — the blinkvault engine (ported from nerfBase /opt/blinkvault)
# as a container: patched blinkpy + ffmpeg + the headless capture service.
# Patches vendored in patches/ (vs stock 0.25.5): liveview v5→v6, OAuth
# app_version 50.1→55.1, re-enabled User-Agent header — the trio that makes
# current Blink accounts work.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg \
 && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir blinkpy==0.25.5 numpy fastapi uvicorn

# overwrite stock blinkpy with the patched files (exact copies of the working rig)
COPY patches/api.py patches/auth.py /usr/local/lib/python3.12/site-packages/blinkpy/

COPY service.py /app/service.py

# creds.json, capture_config.json and clips/ live on the mounted volume
WORKDIR /data
EXPOSE 8080
CMD ["python", "/app/service.py"]
