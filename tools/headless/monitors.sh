#!/bin/bash
# Checks the monitor choice: the notch goes to the monitor named by
# notch-monitor, falls back to the primary one, routes the volume OSD to its
# own monitor, and snaps to that monitor's scale. Run it against a session
# with two monitors (session2.sh, wait.sh) and the notch closed. The headless
# connectors are Meta-0 (primary, index 0) and Meta-1. Usage: monitors.sh
# [scale0 scale1] sets the two scales first (default 1 1). Exits non-zero if
# any check fails.
. "$(dirname "$(readlink -f "$0")")/common.sh"

failures=0
check() {   # check <name> <ok: 0 or 1> <detail>
    if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failures=$((failures + 1)); fi
}
val() {     # val <js>  -> the string the expression returns
    "$HERE/eval.sh" "$1" | python3 -I -c "import sys,re; s=sys.stdin.read(); m=re.match(r\"\(true, '?\\\"?(.*?)\\\"?'?\)\$\", s.strip()); print(m.group(1) if m else 'EVALFAIL ' + s.strip())"
}
wait_a_bit() { timeout "$1" tail -f /dev/null; }
errors() { grep -cE 'JS ERROR|CRITICAL' "$T/shell.log"; }
SETTINGS="Main.extensionManager.lookup('$UUID').stateObj.getSettings()"
# Where the notch is: its monitor index, and whether its centre and top are on that monitor.
PLACED="(() => { const b = global.bn, m = Main.layoutManager.monitors[b.monitorIndex]; return [b.monitorIndex, Math.abs(b.x + b.width / 2 - m.x - m.width / 2) < 1, b.y === m.y, global.display.get_monitor_scale(b.monitorIndex) === b._deviceScale].join(','); })()"

DBUS_SESSION_BUS_ADDRESS=$(bus) python3 -I "$HERE/set-scales.py" "${1:-1}" "${2:-1}" >/dev/null; wait_a_bit 2
val "global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === 'boring-notch'); $SETTINGS.set_string('notch-monitor', 'Meta-1'); 'x'" >/dev/null; wait_a_bit 1.5
two=$(val "String(Main.layoutManager.monitors.length)")
check "two monitors are present" $([ "$two" = 2 ] && echo 1 || echo 0) "monitors=$two"
[ "$two" = 2 ] || { echo "stopping here: this check needs session2.sh"; exit 1; }
placed=$(val "$PLACED")
check "the notch goes to the monitor named by the setting" $([ "$placed" = "1,true,true,true" ] && echo 1 || echo 0) "placed=$placed"

val "$SETTINGS.set_string('notch-monitor', 'DP-9'); 'x'" >/dev/null; wait_a_bit 1.5
placed=$(val "$PLACED")
check "an unplugged display falls back to the primary one" $([ "$placed" = "0,true,true,true" ] && echo 1 || echo 0) "placed=$placed"

val "$SETTINGS.set_string('notch-monitor', 'Meta-1'); 'x'" >/dev/null; wait_a_bit 1.5
val "global.bnHud = []; const orig = global.bn.showHud; global.bn.showHud = function (...a) { global.bnHud.push(a[2]); return orig.apply(this, a); }; 'x'" >/dev/null
val "Main.osdWindowManager._showOsdWindow(1, new Gio.ThemedIcon({name: 'audio-volume-high-symbolic'}), null, 0.3, 1); 'x'" >/dev/null
val "Main.osdWindowManager._showOsdWindow(0, new Gio.ThemedIcon({name: 'audio-volume-high-symbolic'}), null, 0.6, 1); 'x'" >/dev/null
seen=$(val "String(global.bnHud.join(','))")
check "a volume change on the notch's monitor goes to the notch, and another monitor's does not" $([ "$seen" = 0.3 ] && echo 1 || echo 0) "seen=$seen"
val "delete global.bn.showHud; 'x'" >/dev/null

val "$SETTINGS.set_string('notch-monitor', 'primary'); 'x'" >/dev/null; wait_a_bit 1.5
placed=$(val "$PLACED")
check "primary puts it back on the primary monitor" $([ "$placed" = "0,true,true,true" ] && echo 1 || echo 0) "placed=$placed"

val "$SETTINGS.set_string('notch-monitor', 'Meta-1'); 'x'" >/dev/null; wait_a_bit 1
val "Main.extensionManager.disableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 1.5
val "Main.extensionManager.enableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 2
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); "x"' >/dev/null
placed=$(val "$PLACED")
check "after disable and enable it is on the chosen monitor, once" $([ "$placed" = "1,true,true,true" ] && [ "$(val 'String(Main.layoutManager.uiGroup.get_children().filter(a => a.name === "boring-notch").length)')" = 1 ] && echo 1 || echo 0) "placed=$placed"

val "$SETTINGS.set_string('notch-monitor', 'primary'); 'x'" >/dev/null; wait_a_bit 1
check "log has no JS errors from the monitor choice" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
