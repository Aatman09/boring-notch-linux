#!/bin/bash
# Quick checks that catch the failures that broke the first phase-2 commits:
# a branch that does not load, and notifications that stop working. Run it
# against a running session (session.sh, then wait.sh) before every commit.
# Exits non-zero if any check fails.
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

# 1. The extension loads and is enabled.
state=$(val "Main.extensionManager.lookup('$UUID').state")
check "extension is enabled" $([ "$state" = 1 ] && echo 1 || echo 0) "state=$state, expected 1"
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); "x"' >/dev/null
check "the notch is on screen" $([ "$(val 'String(!!global.bn)')" = true ] && echo 1 || echo 0) "no actor named boring-notch"
[ "$state" = 1 ] || { echo "stopping here: nothing else can work"; exit 1; }

# 2. No errors so far.
check "log has no JS errors at startup" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines"

# 3. Notifications work, including the kind almost every app sends: one with
#    a themed icon. A crash there once froze every later notification.
val 'global.bn._clearPeeks(); Main.messageTray.getSources().forEach(s => s.destroy()); "x"' >/dev/null; wait_a_bit 1
DBUS_SESSION_BUS_ADDRESS=$(bus) notify-send -i dialog-information "Smoke test" "themed icon"; wait_a_bit 1.2
shown=$(val 'String(global.bn._sneak !== null || global.bn._peeks.length > 0)')
queue=$(val 'String(Main.messageTray.queueCount)')
check "a notification with a themed icon shows a peek" $([ "$shown" = true ] && echo 1 || echo 0) "peek shown=$shown"
check "and does not leave the tray queue stuck" $([ "$queue" = 0 ] && echo 1 || echo 0) "queue=$queue"
val 'global.bn._clearPeeks(); Main.notify("Smoke test", "plain"); "x"' >/dev/null; wait_a_bit 1.2
check "a plain notification shows a peek afterwards" $([ "$(val 'String(global.bn._sneak !== null)')" = true ] && echo 1 || echo 0) "no peek"
val 'global.bn._clearPeeks(); "x"' >/dev/null

# 4. Disable and enable again: still works, one notch, one handler per event.
val "Main.extensionManager.disableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 1.5
val "Main.extensionManager.enableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 2
state=$(val "Main.extensionManager.lookup('$UUID').state")
check "disable then enable leaves it enabled" $([ "$state" = 1 ] && echo 1 || echo 0) "state=$state"
check "and exactly one notch on screen" $([ "$(val 'String(Main.layoutManager.uiGroup.get_children().filter(a => a.name === "boring-notch").length)')" = 1 ] && echo 1 || echo 0) "wrong count"
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); "x"' >/dev/null
calls=$(val 'global.bn._clearPeeks(); let n = 0; const orig = global.bn._showPeek.bind(global.bn); global.bn._showPeek = p => { n++; return orig(p); };
  global.bn._keyboard.emit("caps-lock", true); global.bn._battery.emit("warning", 3); const r = n; global.bn._showPeek = orig; global.bn._clearPeeks(); String(r)')
check "each event reaches the island once after re-enabling" $([ "$calls" = 2 ] && echo 1 || echo 0) "calls=$calls, expected 2 (a leaked listener doubles them)"

# 5. No errors after all of that.
check "log has no JS errors at the end" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
