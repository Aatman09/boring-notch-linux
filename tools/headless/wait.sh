#!/bin/bash
# Waits for the headless shell, then makes it easy to test: the notch is
# reachable as global.bn, the top bar is transparent so the notch's shape
# shows, and the startup notification is hidden.
# Usage: wait.sh [--scale 1.25]
. "$(dirname "$(readlink -f "$0")")/common.sh"
for i in $(seq 1 60); do "$HERE/eval.sh" 1 2>/dev/null | grep -q true && break; timeout 1 tail -f /dev/null; done
timeout 2 tail -f /dev/null
[ "$1" = --scale ] && { DBUS_SESSION_BUS_ADDRESS=$(bus) python3 -I "$HERE/set-scale.py" "$2"; timeout 2 tail -f /dev/null; }
"$HERE/eval.sh" "const e = Main.extensionManager.lookup('$UUID');
  Main.messageTray._bannerBin.hide();
  Main.layoutManager.panelBox.set_style('background-color: transparent;');
  Main.panel.set_style('background-color: transparent;');
  global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === 'boring-notch');
  'state=' + e?.state + ' ' + (e?.error ?? '')"
grep -iE "JS ERROR|JS WARNING|CRITICAL" "$T/shell.log" | grep -v unsafe | head -5
