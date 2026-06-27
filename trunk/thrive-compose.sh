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

# This host's primary LAN IP — passed into the api container so it can report the
# appliance's address at GET /system/info. A bridged container only sees its own
# 172.x address, so we resolve it host-side. `hostname -I` lists every address;
# drop loopback, docker bridges (172.16–31), and link-local, take the first left.
# (`ip` isn't present on the minimal appliance image, so we don't rely on it.)
export HOST_LAN_IP="${HOST_LAN_IP:-$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^(127\.|169\.254\.|172\.(1[6-9]|2[0-9]|3[01])\.)' | head -1)}"

files=(-f "$here/docker-compose.yml")
for c in "$here"/../modules/*/compose.yml; do
    [ -f "$c" ] && files+=(-f "$c")
done

exec docker compose "${files[@]}" "$@"
