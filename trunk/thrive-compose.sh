#!/usr/bin/env bash
# thrive-compose — bring up the thrive stack: trunk + every module that ships its
# own container. A module's services run iff the module is present in modules/
# (its modules/<name>/compose.yml is merged in) — "physically there = installed".
# Trunk itself never names a module; this is how opt-in module infrastructure
# (e.g. vault's Vaultwarden) attaches without trunk hardcoding it.
#
# Usage (from anywhere): trunk/thrive-compose.sh <docker-compose args>
#   trunk/thrive-compose.sh up -d --build
#   trunk/thrive-compose.sh down
#   trunk/thrive-compose.sh ps
#
# The first -f is trunk/docker-compose.yml, so the compose PROJECT DIRECTORY is
# trunk/ — module fragments' relative paths (e.g. ./data/vault) resolve there too.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"

# This host's primary LAN IP (source IP of the default route) — passed into the
# api container so it can report the appliance's address at GET /system/info. A
# bridged container only sees its own 172.x address, so we resolve it host-side.
export HOST_LAN_IP="${HOST_LAN_IP:-$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')}"

files=(-f "$here/docker-compose.yml")
for c in "$here"/../modules/*/compose.yml; do
    [ -f "$c" ] && files+=(-f "$c")
done

exec docker compose "${files[@]}" "$@"
