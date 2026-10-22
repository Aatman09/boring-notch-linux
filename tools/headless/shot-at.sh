#!/bin/bash
# Screenshots a rectangle of the stage, in screen pixels. Usage: shot-at.sh name x y width height
# Prints the path of the PNG. Use it for a monitor other than the primary one.
. "$(dirname "$(readlink -f "$0")")/common.sh"
mkdir -p "$T/shots"
DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session --dest org.gnome.Shell.Screenshot \
  --object-path /org/gnome/Shell/Screenshot --method org.gnome.Shell.Screenshot.ScreenshotArea \
  "$2" "$3" "$4" "$5" false "$T/shots/$1.png" >/dev/null && echo "$T/shots/$1.png"
