# tv module — filling OTA guide gaps (free XMLTV grabber)

The tv guide (#88) reads EPG from Jellyfin, which sources it from **Tvheadend's
XMLTV output** (`ListingsProvider: xmltv → http://tvheadend:9981/xmltv/channels`).
Over-the-air EIT only carries program data for the major stations (~21/58
channels here); shopping/music/religious sub-channels broadcast none.

To fill the rest we enrich **Tvheadend's** EPG with a free XMLTV grabber
(zap2xml scraping Gracenote). Because Jellyfin mirrors Tvheadend, the enriched
guide flows through automatically — **no Jellyfin or thrive-module changes.**

> **This lives in the DVR stack, not thrive.** Tvheadend + Jellyfin run as a
> separate, non-git compose project at **`/opt/tv`** on nerfCore. The pieces
> below are documented here (the module they benefit) for reproducibility, but
> they are applied to `/opt/tv/docker-compose.yml` + the live Tvheadend config.

## Pipeline
```
zap2xml (scrape Gracenote by zip, every 6h)
  → /opt/tv/xmltv/xmltv.xml
  → xmltv-push sidecar (pipe into Tvheadend's import socket, every 6h)
  → Tvheadend "External: XMLTV" grabber (channels mapped by number)
  → Tvheadend EPG → /xmltv/channels → Jellyfin (daily guide refresh) → thrive guide
```

## 1. Sidecars (appended to `/opt/tv/docker-compose.yml`)
```yaml
  zap2xml:
    image: ghcr.io/jef/zap2xml:latest
    container_name: zap2xml
    environment:
      - LINEUP_ID=USA-lineupId-DEFAULT   # = antenna / OTA
      - COUNTRY=USA
      - POSTAL_CODE=73135                 # OKC metro; OTA lineup is metro-wide
      - TIMESPAN=168                      # 7 days of guide
      - OUTPUT_FILE=/xmltv/xmltv.xml
      - SLEEP_TIME=21600                  # refresh every 6h
      - TZ=America/Chicago
    volumes:
      - /opt/tv/xmltv:/xmltv
    restart: unless-stopped

  xmltv-push:                            # pipes the file into Tvheadend's socket
    image: python:3-alpine
    container_name: xmltv-push
    depends_on: [tvheadend, zap2xml]
    volumes:
      - /opt/tv/xmltv:/xmltv:ro
      - /opt/tv/tvheadend/config/epggrab:/sock
    command: [python3, -c, "<socket-push loop, every 21600s>"]  # see compose
    restart: unless-stopped
```

## 2. Tvheadend wiring (one-time, via its API — anonymous admin on LAN)
- Enable the **External: XMLTV** grabber module → creates
  `/config/epggrab/xmltv.sock`:
  `POST /api/idnode/save  node={"uuid":"<External:XMLTV uuid>","enabled":true}`
- Push once to create the 78 grabber channels, then **map by channel number**:
  each XMLTV channel's `names` ends with its number (e.g. `…,"30.2"`), matched
  to the Tvheadend channel with `number == "30.2"`
  (`POST /api/idnode/save node={"uuid":<grabberCh>,"channels":[<tvhCh uuid>]}`).
- Persisted under `/opt/tv/tvheadend/config/epggrab/xmltv/channels/`.

Result: **58/58 channels** now carry guide data (was 21/58).

## Persistence (survives reboots)
- All four containers are `restart: unless-stopped` and Docker is enabled on
  boot → the stack comes back on host reboot.
- Tvheadend's **External: XMLTV** module state and the **78 channel mappings**
  persist on disk (`epggrab/config`, `epggrab/xmltv/channels/`).
- The pusher **re-pushes on startup** and retries every 60s until the first
  push succeeds (survives the boot race where it starts before Tvheadend has
  created the socket), then settles to every 6h. So even if Tvheadend's
  in-memory EPG is lost on restart, it repopulates from the on-disk XMLTV within
  a minute — no manual step needed.

## Refresh & maintenance
- zap2xml re-scrapes every 6h; xmltv-push re-pushes every 6h; Jellyfin's own
  guide-refresh task (daily) pulls it. EPG is 7-day, so hours of lag are moot.
- **Gracenote scraping breaks periodically** (the free-vs-Schedules-Direct
  tradeoff) — if the guide goes stale, check `docker logs zap2xml`. Usually a
  zap2xml image bump fixes it. Schedules Direct (~$35/yr) is the paid, stable
  alternative (Tvheadend has native support).
- 3 sub-channels (46.2/46.3 KOCM, 62.9 ShopLC) were absent/oddly-numbered in
  Gracenote; they resolved after the guide refresh but may need a manual map if
  they blank out.

## Reverse
`docker compose rm -sf zap2xml xmltv-push` (remove the two services from the
compose), and disable the External: XMLTV grabber module in Tvheadend. Guide
reverts to OTA-EIT-only.
