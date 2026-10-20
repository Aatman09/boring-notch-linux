#!/bin/bash
# Screenshots the top middle of the screen. Usage: shot.sh name [width height]
# Prints the path of the PNG (in device pixels).
. "$(dirname "$(readlink -f "$0")")/common.sh"
W=${2:-800}; H=${3:-240}; mkdir -p "$T/shots"
SW=$("$HERE/eval.sh" 'Main.layoutManager.primaryMonitor.width' | grep -o '[0-9]\+' | tail -1)
DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.ScreenshotArea \
  $(( (SW - W) / 2 )) 0 "$W" "$H" false "$T/shots/$1.png" >/dev/null && echo "$T/shots/$1.png"
