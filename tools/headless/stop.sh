#!/bin/bash
# Stops the headless shell and everything started inside its session.
. "$(dirname "$(readlink -f "$0")")/common.sh"
for p in $(pgrep -u "$USER"); do
  grep -qz "HOME=$T/home" /proc/$p/environ 2>/dev/null && kill "$p" 2>/dev/null
done
echo stopped
