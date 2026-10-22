#!/bin/bash
# Checks that a notification posted with real actions shows the buttons on
# the notch's peek and answers a button press with ActionInvoked, and that
# the peek ends. Run it against a running session (session.sh, wait.sh).
#
# Note: notify-send never sends actions on this setup ("Actions are not
# supported by this notifications server", libnotify 0.8.8), so the post
# is a gdbus call; that carries the actions array as real callers do.
. "$(dirname "$(readlink -f "$0")")/common.sh"

failures=0
check() {
    if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failures=$((failures + 1)); fi
}
val() {
    "$HERE/eval.sh" "$1" | python3 -I -c "import sys,re; s=sys.stdin.read(); m=re.match(r\"\(true, '?\\\"?(.*?)\\\"?'?\)\$\", s.strip()); print(m.group(1) if m else 'EVALFAIL ' + s.strip())"
}

# Post a notification with two actions, read the buttons, press the first
# one, and watch the bus for the answer.
DBUS_SESSION_BUS_ADDRESS=$(bus) timeout 25 dbus-monitor --session "type='signal',member='ActionInvoked'" > "$T/mon.log" 2>&1 &
MONPID=$!
timeout 1 tail -f /dev/null

ID=$(DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session \
    --dest org.freedesktop.Notifications \
    --object-path /org/freedesktop/Notifications \
    --method org.freedesktop.Notifications.Notify \
    "actions.sh" 0 "dialog-information-symbolic" "Action check" "tap a button" \
    '["look", "Look", "pack", "Pack"]' "{}" 20000 \
    | tr -d '(),' | awk '{print $2}')
timeout 1.5 tail -f /dev/null

button=$(val 'global.bn._systemPeeks.messageView._buttons.get_children().map(b => b.label).join(",")')
check "the peek shows the notification's buttons" $([ "$button" = "Look,Pack" ] && echo 1 || echo 0) "buttons=$button"

val 'global.bn._systemPeeks.messageView._buttons.get_children()[0].emit("clicked", 1)' >/dev/null
timeout 2 tail -f /dev/null

answer=$(grep -A2 "member=ActionInvoked" "$T/mon.log" | tr '\n' ' ')
check "the press answers ActionInvoked $ID with action look" \
    $(echo "$answer" | grep -q "uint32 $ID" && echo "$answer" | grep -q '"look"' && echo 1 || echo 0) \
    "on the bus: $answer"
pressed=$(val 'String(global.bn.peekView === null)')
check "the peek ends after a button press" $([ "$pressed" = "true" ] && echo 1 || echo 0) "sneak=$pressed"

kill $MONPID 2>/dev/null
echo
notify-send -A reply -t 1000 "Action check" 2>&1 | grep -q "not supported" && \
    echo "note: notify-send never sends actions here; use the gdbus call as above"
echo
[ $failures = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
