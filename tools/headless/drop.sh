#!/bin/bash
# Drags a file from a test window onto the notch with a virtual pointer and
# checks that the notch opens on the Shelf and the file lands on it. Run it
# against a running session (session.sh, wait.sh) with the notch closed.
. "$(dirname "$(readlink -f "$0")")/common.sh"

failures=0
check() {
    if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failures=$((failures + 1)); fi
}
val() {
    "$HERE/eval.sh" "$1" | python3 -I -c "import sys,re; s=sys.stdin.read(); m=re.match(r\"\(true, '?\\\"?(.*?)\\\"?'?\)\$\", s.strip()); print(m.group(1) if m else 'EVALFAIL ' + s.strip())"
}
wait_a_bit() { timeout "$1" tail -f /dev/null; }

FILE="$T/home/drop-test.txt"
echo "dropped on the notch" > "$FILE"
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); global.bn._sources.shelf.clear(); "x"' >/dev/null

# The source window, started by the shell so it lands on its display, then
# moved to a known place.
val "Gio.Subprocess.new(['gjs', '-m', '$HERE/drag-source.js', '$FILE'], Gio.SubprocessFlags.NONE); 'x'" >/dev/null
wait_a_bit 3
val 'const w = global.display.list_all_windows().find(w => w.get_title() === "Drag source"); w.move_resize_frame(false, 200, 400, 300, 200); w.activate(global.get_current_time()); "x"' >/dev/null
wait_a_bit 1

# A virtual pointer: press on the source, move in steps to the notch, then
# down into the open Shelf, and let go.
P='global.bnPtr'
val "const C = imports.gi.Clutter; $P = global.stage.context.get_backend().get_default_seat().create_virtual_device(C.InputDeviceType.POINTER_DEVICE); 'x'" >/dev/null
move() { val "$P.notify_absolute_motion(GLib.get_monotonic_time(), $1, $2); 'x'" >/dev/null; wait_a_bit 0.05; }
button() { val "const C = imports.gi.Clutter; $P.notify_button(GLib.get_monotonic_time(), C.BUTTON_PRIMARY, C.ButtonState.$1); 'x'" >/dev/null; }
move 350 500; wait_a_bit 0.3
button PRESSED; wait_a_bit 0.3
for step in 1 2 3 4 5 6 7 8 9 10; do move $((350 + step * 10)) $((500 - step * 5)); done
wait_a_bit 1
CX=$(val 'String(Math.round(global.bn.rectFor(null).x + global.bn.rectFor(null).width / 2))')
for y in 400 300 200 100 40 15; do move "$CX" "$y"; wait_a_bit 0.2; done
wait_a_bit 1.5
opened=$(val 'String(global.bn.isOpen && global.bn._tab)')
check "a drag to the notch opens it on the Shelf" $([ "$opened" = shelf ] && echo 1 || echo 0) "open/tab=$opened"
helper=$(val 'String(!!global.display.list_all_windows().find(w => w.get_wm_class() === "io.github.aatman09.BoringNotchDrop"))')
check "the drop target window is there" $([ "$helper" = true ] && echo 1 || echo 0) "helper=$helper"
for y in 60 100 120; do move "$CX" "$y"; wait_a_bit 0.3; done
wait_a_bit 1
button RELEASED
wait_a_bit 2
first=$(val 'String(global.bn._sources.shelf.paths[0])')
check "the dropped file is on the shelf" $([ "$first" = "$FILE" ] && echo 1 || echo 0) "first=$first"
wait_a_bit 2
gone=$(val 'String(!global.display.list_all_windows().find(w => w.get_wm_class() === "io.github.aatman09.BoringNotchDrop"))')
check "the drop target goes after the drop" $([ "$gone" = true ] && echo 1 || echo 0) "still there"
picked=$(val "String(global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.REACTIVE, $CX, 10) === global.bn || global.bn.contains(global.stage.get_actor_at_pos(imports.gi.Clutter.PickMode.REACTIVE, $CX, 10)))")
check "the notch takes the pointer again" $([ "$picked" = true ] && echo 1 || echo 0) "picked=$picked"

# A drag that ends away from the notch: the notch stays closed and the drop
# target goes.
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1.5
move 350 500; wait_a_bit 0.3
button PRESSED; wait_a_bit 0.3
for step in 1 2 3 4 5 6 7 8 9 10; do move $((350 + step * 10)) $((500 - step * 5)); done
wait_a_bit 1.5
started=$(val 'String(!!global.display.list_all_windows().find(w => w.get_wm_class() === "io.github.aatman09.BoringNotchDrop"))')
move 700 700; wait_a_bit 0.3
button RELEASED; wait_a_bit 1.5
gone=$(val 'String(!global.display.list_all_windows().find(w => w.get_wm_class() === "io.github.aatman09.BoringNotchDrop"))')
closed=$(val 'String(!global.bn.isOpen)')
check "a drag elsewhere starts the target, leaves the notch closed and ends the target" \
    $([ "$started$gone$closed" = truetruetrue ] && echo 1 || echo 0) "started=$started gone=$gone closed=$closed"

val 'global.bnPtr = null; const w = global.display.list_all_windows().find(w => w.get_title() === "Drag source"); w?.delete(global.get_current_time()); "x"' >/dev/null
check "log has no JS errors" $([ "$(grep -cE 'JS ERROR|CRITICAL' "$T/shell.log")" = 0 ] && echo 1 || echo 0) "$(grep -m1 -E 'JS ERROR|CRITICAL' "$T/shell.log" | cut -c1-160)"
echo
[ "$failures" = 0 ] && echo "all drop checks passed" || echo "$failures drop check(s) failed"
exit $((failures > 0))
