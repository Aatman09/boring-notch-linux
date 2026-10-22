#!/bin/bash
# Checks the System tab: it appears with its setting, samples only while it
# is on screen in the open notch, and goes back to Home when the setting is
# turned off. Run it against a running session (session.sh, wait.sh), with
# the notch closed. Exits non-zero if any check fails.
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
SYS='global.bn._openView._pages.system'

val "$SETTINGS.set_boolean('show-system-tab', true); 'x'" >/dev/null; wait_a_bit 1
shown=$(val "String(global.bn._openView._header._tabs.get('system').visible)")
check "the System tab shows when its setting is on" $([ "$shown" = true ] && echo 1 || echo 0) "visible=$shown"

val "global.bn.open('system'); 'x'" >/dev/null; wait_a_bit 4.5
active=$(val "String(global.bn._openView._sysmon._active && global.bn.isOpen)")
check "open notch on the System tab starts sampling" $([ "$active" = true ] && echo 1 || echo 0) "active=$active"
samples=$(val "String($SYS._history.cpu.length)")
check "and it has samples after a few seconds" $([ "$samples" -ge 3 ] 2>/dev/null && echo 1 || echo 0) "samples=$samples"
cpu=$(val "$SYS._cpuLabel.text")
check "the processor reading is shown" $([ "${cpu%\%}" != "$cpu" ] && echo 1 || echo 0) "label=$cpu"

val "global.bn.close(); 'x'" >/dev/null; wait_a_bit 1
stopped=$(val "String(!global.bn._openView._sysmon._active && global.bn._openView._sysmon._timeoutId === 0)")
check "closing the notch stops the sampler and its timer" $([ "$stopped" = true ] && echo 1 || echo 0) "stopped=$stopped"
before=$(val "String($SYS._history.cpu.length)"); wait_a_bit 3
after=$(val "String($SYS._history.cpu.length)")
check "no samples arrive while the notch is closed" $([ "$before" = "$after" ] && echo 1 || echo 0) "before=$before after=$after"

val "$SETTINGS.set_boolean('show-system-tab', false); 'x'" >/dev/null; wait_a_bit 1
hidden=$(val "String(!global.bn._openView._header._tabs.get('system').visible)")
check "the tab hides when its setting is turned off" $([ "$hidden" = true ] && echo 1 || echo 0) "still visible"
val "global.bn.open('system'); 'x'" >/dev/null; wait_a_bit 1
tab=$(val "global.bn._openView._tab")
check "opening the System tab with the setting off opens Home" $([ "$tab" = home ] && echo 1 || echo 0) "tab=$tab"
val "$SETTINGS.set_boolean('show-system-tab', true); global.bn.open('system'); 'x'" >/dev/null; wait_a_bit 1.5
val "$SETTINGS.set_boolean('show-system-tab', false); 'x'" >/dev/null; wait_a_bit 1.5
tab=$(val "global.bn._openView._tab")
check "turning the setting off while the tab is open moves to Home" $([ "$tab" = home ] && echo 1 || echo 0) "tab=$tab"
val "global.bn.close(); $SETTINGS.set_boolean('show-system-tab', false); 'x'" >/dev/null; wait_a_bit 1

check "log has no JS errors from the System tab" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
