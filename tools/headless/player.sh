#!/bin/bash
# Starts the fake music player in the headless session. Usage: player.sh [art.png|none]
. "$(dirname "$(readlink -f "$0")")/common.sh"
DBUS_SESSION_BUS_ADDRESS=$(bus) nohup gjs -m "$HERE/fake-player.js" \
    "${1:-/usr/share/backgrounds/cnusr25-Simple_Raccoon_Dark.png}" \
    "${2:-}" > "$T/player.log" 2>&1 &
echo $! > "$T/player.pid"
