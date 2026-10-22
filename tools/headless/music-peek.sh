#!/bin/bash
# Checks when the music peek shows: for a new track only, never for a pause
# and resume or a seek. Run it against a running session (session.sh,
# wait.sh) with the notch closed; it starts the fake player itself.
. "$(dirname "$(readlink -f "$0")")/common.sh"

failures=0
check() {
    if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failures=$((failures + 1)); fi
}
val() {
    "$HERE/eval.sh" "$1" | python3 -I -c "import sys,re; s=sys.stdin.read(); m=re.match(r\"\(true, '?\\\"?(.*?)\\\"?'?\)\$\", s.strip()); print(m.group(1) if m else 'EVALFAIL ' + s.strip())"
}
wait_a_bit() { timeout "$1" tail -f /dev/null; }

"$HERE/player.sh" none "First song@Artist|Second song@Artist"
# Players found in the first two seconds do not peek; wait past that.
wait_a_bit 4
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); global.bn._clearPeeks(); global.bnMusicPeeks = 0; const show = global.bn.showPeek.bind(global.bn); global.bn.showPeek = p => { if (p.key === "music") global.bnMusicPeeks++; show(p); }; "x"' >/dev/null
peeks() { val 'String(global.bnMusicPeeks)'; }
player() { val "global.bn._media.activePlayer.$1; 'x'" >/dev/null; }

player 'playPause()'; wait_a_bit 1
player 'playPause()'; wait_a_bit 1
check "pausing and playing again does not peek" $([ "$(peeks)" = 0 ] && echo 1 || echo 0) "peeks=$(peeks)"

player 'skip(15)'; wait_a_bit 1
player 'skip(-15)'; wait_a_bit 1
check "seeking does not peek" $([ "$(peeks)" = 0 ] && echo 1 || echo 0) "peeks=$(peeks)"

# A browser reports a seek as a short pause while it buffers.
player 'playPause()'; wait_a_bit 0.2
player 'playPause()'; wait_a_bit 1
check "a short pause during a seek does not peek" $([ "$(peeks)" = 0 ] && echo 1 || echo 0) "peeks=$(peeks)"

player 'next()'; wait_a_bit 1.5
check "the next track peeks once" $([ "$(peeks)" = 1 ] && echo 1 || echo 0) "peeks=$(peeks)"

kill "$(cat "$T/player.pid")" 2>/dev/null
val 'global.bn.showPeek = Object.getPrototypeOf(global.bn).showPeek.bind(global.bn); "x"' >/dev/null
echo
[ "$failures" = 0 ] && echo "all music peek checks passed" || echo "$failures music peek check(s) failed"
exit $((failures > 0))
