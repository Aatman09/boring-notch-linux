#!/bin/bash
# Checks the synced lyrics without the internet. The lyrics service keeps its
# real code (request, retry, cache, LRC parsing, the Home player's line) but
# its Soup session is swapped for a fake that answers from this script. Run it
# against a running session (session.sh, wait.sh) with the notch closed; it
# starts the fake music player. Exits non-zero if any check fails.
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
SVC="Main.extensionManager.lookup('$UUID').stateObj._sources.lyrics"
# Lines are split by | and joined with newlines in the shell, so no escapes reach
# gdbus (an escaped n would become a line break inside the JavaScript).
LRC='[00:00.00]First line|[00:05.50]Second line|[00:10.00]Third line'
BODY="JSON.stringify({syncedLyrics: '$LRC'.split('|').join(String.fromCharCode(10))})"

# The fake session: a request answers with global.bnBody (JSON), or fails when
# that is null; global.bnStatus is the HTTP status (set on the message, as
# a real answer would be). global.bnCalls counts them.
val "global.bnCalls = 0; global.bnBody = null; global.bnStatus = 200;
  global.bnReal = global.bnReal ?? $SVC._session;
  $SVC._session = {
    send_and_read_async(message, priority, cancellable, callback) {
      global.bnCalls++;
      message.get_status = () => global.bnStatus;
      callback(this, {});
    },
    send_and_read_finish(res) {
      if (global.bnBody === null)
        throw new Error('offline');
      return new GLib.Bytes(new TextEncoder().encode(global.bnBody));
    },
  };
  'x'" >/dev/null
installed=$(val "String($SVC._session.send_and_read_async !== undefined && $SVC._session !== global.bnReal)")
check "the fake session answers in place of lrclib.net" $([ "$installed" = true ] && echo 1 || echo 0) "not installed"

val "$SETTINGS.set_boolean('show-lyrics', true); global.bnBody = $BODY; 'x'" >/dev/null
"$HERE/player.sh" none "Lyric Song@Tester"; wait_a_bit 4
val "global.bn.open('home'); 'x'" >/dev/null; wait_a_bit 1
loaded=$(val "String($SVC._lines.length)")
check "a track with synced lyrics loads them once" $([ "$loaded" = 3 ] && echo 1 || echo 0) "lines=$loaded"
calls=$(val "String(global.bnCalls)")
check "and asks lrclib once for it" $([ "$calls" = 1 ] && echo 1 || echo 0) "calls=$calls"

line_at() {   # line_at <seconds>: the Home player's lyric line at that position
    val "global.bn._media.activePlayer._setPosition($1 * 1e6); global.bn._openView._player.tick(); String(global.bn._openView._player._lyric.text)"
}
check "the line for 0.5 s is the first" $([ "$(line_at 0.5)" = "First line" ] && echo 1 || echo 0) "got $(line_at 0.5)"
check "the line for 6 s is the second" $([ "$(line_at 6)" = "Second line" ] && echo 1 || echo 0) "got $(line_at 6)"
check "the line for 11 s is the third" $([ "$(line_at 11)" = "Third line" ] && echo 1 || echo 0) "got $(line_at 11)"
shown=$(val "String(global.bn._openView._player._lyric.visible)")
check "the lyric label is shown while the line is" $([ "$shown" = true ] && echo 1 || echo 0) "visible=$shown"

val "global.bn._syncMedia(); 'x'" >/dev/null
calls=$(val "String(global.bnCalls)")
check "a change to the same track does not ask again" $([ "$calls" = 1 ] && echo 1 || echo 0) "calls=$calls"
cached=$(val "String(GLib.Dir.open(GLib.build_filenamev([GLib.get_user_cache_dir(), 'boring-notch-linux', 'lyrics']), 0).read_name() !== null)")
check "the answer is kept in the cache folder" $([ "$cached" = true ] && echo 1 || echo 0) "no cache file"

val "global.bnBody = null; $SVC.follow({title: 'Offline Song', artists: 'Tester', album: '', length: 100e6}); 'x'" >/dev/null; wait_a_bit 1
calls=$(val "String(global.bnCalls)")
check "a failed request is retried once, so two requests" $([ "$calls" = 3 ] && echo 1 || echo 0) "calls=$calls"
val "$SVC.follow({title: 'Offline Song', artists: 'Tester', album: '', length: 100e6}); 'x'" >/dev/null; wait_a_bit 1
calls=$(val "String(global.bnCalls)")
check "and the same track is not asked again after that" $([ "$calls" = 3 ] && echo 1 || echo 0) "calls=$calls"
none=$(val "String($SVC.lineAt(5e6) === '')")
check "a failed track shows no line" $([ "$none" = true ] && echo 1 || echo 0) "shows a line"

val "global.bnBody = JSON.stringify({syncedLyrics: ''}); $SVC.follow({title: 'Plain Song', artists: 'Tester', album: '', length: 90e6}); 'x'" >/dev/null; wait_a_bit 1
calls=$(val "String(global.bnCalls)")
check "a track with no synced lyrics asks once and shows nothing" $([ "$calls" = 4 ] && echo 1 || echo 0) "calls=$calls"

val "$SVC.follow(null); global.bnBody = $BODY; 'x'" >/dev/null
val "$SVC.follow({title: 'Lyric Song', artists: 'Tester', album: 'Album', length: 200e6}); 'x'" >/dev/null; wait_a_bit 1
calls=$(val "String(global.bnCalls)")
check "a track seen before is read from the cache, not asked again" $([ "$calls" = 4 ] && echo 1 || echo 0) "calls=$calls"
loaded=$(val "String($SVC._lines.length)")
check "and it has its lines again" $([ "$loaded" = 3 ] && echo 1 || echo 0) "lines=$loaded"

val "global.bnCalls = 0; $SETTINGS.set_boolean('show-lyrics', false); global.bn._syncMedia(); 'x'" >/dev/null; wait_a_bit 1
forgot=$(val "String($SVC._key === null)")
check "turning the setting off forgets the track" $([ "$forgot" = true ] && echo 1 || echo 0) "key kept"
val "global.bn.open('home'); 'x'" >/dev/null; wait_a_bit 1
calls=$(val "String(global.bnCalls)")
check "with the setting off nothing is requested" $([ "$calls" = 0 ] && echo 1 || echo 0) "calls=$calls"
hidden=$(val "String(!global.bn._openView._player._lyric.visible)")
check "and no lyric line shows" $([ "$hidden" = true ] && echo 1 || echo 0) "still visible"

val "$SVC._session = global.bnReal; global.bn.close(); 'x'" >/dev/null
# Leave the session as the other checks expect it: notch closed, no player.
kill "$(cat "$T/player.pid")" 2>/dev/null
check "log has no JS errors from the lyrics" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
