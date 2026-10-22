#!/bin/bash
# Checks the Shelf tab against a running session (session.sh, then wait.sh):
# paste from the clipboard, finished downloads and new screenshots, Remove,
# dropping files that are gone, and that the shelf survives a restart.
# Test files go in $BN_TEST_DIR/files. Exits non-zero if any check fails.
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
shelf_js='const v = global.bn._openView._pages.shelf;'
paths() { val "$shelf_js v._shelf.paths.join('|')"; }

mkdir -p "$T/files"
printf 'hello\n' > "$T/files/notes.txt"
printf '%%PDF-1.4\n' > "$T/files/report.pdf"

# 1. Paste: a file manager's copy is a text/uri-list; the first file ends up newest.
"$HERE/eval.sh" "const {GLib, St} = imports.gi; const nl = String.fromCharCode(13, 10);
  St.Clipboard.get_default().set_content(St.ClipboardType.CLIPBOARD, 'text/uri-list',
    new GLib.Bytes('file://$T/files/notes.txt' + nl + 'file://$T/files/report.pdf' + nl));
  global.bn.open('shelf'); $shelf_js v._pasteFiles(); 'x'" >/dev/null; wait_a_bit 1
want="$T/files/notes.txt|$T/files/report.pdf"
got=$(paths)
check "paste adds the two files, newest first" $([ "$got" = "$want" ] && echo 1 || echo 0) "got=$got"
rows=$(val "$shelf_js String(v._list.get_children().length)")
check "the tab shows one row per file" $([ "$rows" = 2 ] && echo 1 || echo 0) "rows=$rows"
cache=$(python3 -I -c "import json,sys; print('|'.join(json.load(open(sys.argv[1]))['paths']))" "$T/cache/boring-notch-linux/shelf.json" 2>/dev/null)
check "the list is written to the cache folder" $([ "$cache" = "$want" ] && echo 1 || echo 0) "file=$cache"

# 2. A finished download joins the shelf when it is renamed out of .part.
printf 'partial' > "$T/home/Downloads/movie.mkv.part"; wait_a_bit 1
mv "$T/home/Downloads/movie.mkv.part" "$T/home/Downloads/movie.mkv"; wait_a_bit 1.5
check "a finished download is added" $([ "$(paths | cut -d'|' -f1)" = "$T/home/Downloads/movie.mkv" ] && echo 1 || echo 0) "first=$(paths | cut -d'|' -f1)"

# 3. A new screenshot joins the shelf. GNOME makes the Screenshots folder on
#    the first screenshot; the test makes it, then toggles the setting, which
#    starts the watch on it.
mkdir -p "$T/home/Pictures/Screenshots"
val "Main.extensionManager.lookup('$UUID').stateObj._settings.set_boolean('shelf-auto-add', false); 'off'" >/dev/null
val "Main.extensionManager.lookup('$UUID').stateObj._settings.set_boolean('shelf-auto-add', true); 'on'" >/dev/null; wait_a_bit 1
printf 'png' > "$T/home/Pictures/Screenshots/Screenshot From test.png"; wait_a_bit 1.5
check "a new screenshot is added" $([ "$(paths | cut -d'|' -f1)" = "$T/home/Pictures/Screenshots/Screenshot From test.png" ] && echo 1 || echo 0) "first=$(paths | cut -d'|' -f1)"

# 4. Remove: the Remove button of the first row takes that file off the shelf.
before=$(val "$shelf_js String(v._shelf.paths.length)")
val "$shelf_js const row = v._list.get_children()[0].get_children()[0]; row.get_children().at(-1).emit('clicked', null); 'x'" >/dev/null
after=$(val "$shelf_js String(v._shelf.paths.length)")
check "Remove takes one file off" $([ "$before" -gt 0 ] && [ "$after" = $((before - 1)) ] && echo 1 || echo 0) "before=$before after=$after"

# 5. A file deleted since it was added leaves the shelf when the tab opens.
rm -f "$T/files/report.pdf"
val "global.bn.close(); 'x'" >/dev/null; wait_a_bit 0.5
val "global.bn.open('shelf'); 'x'" >/dev/null; wait_a_bit 1
check "a deleted file is dropped when the tab opens" $([ "$(paths | grep -c report.pdf)" = 0 ] && echo 1 || echo 0) "paths=$(paths)"

# 5b. Share: a Share button with the targets found here, which goes when
#     shelf-share is off. Nothing is sent here: the test does not open mail or
#     Bluetooth.
settings="Main.extensionManager.lookup('$UUID').stateObj._settings"
val "$shelf_js v._shelf.add('$T/files/notes.txt'); 'x'" >/dev/null; wait_a_bit 0.5
targets=$(val "$shelf_js v._toggleShare('$T/files/notes.txt'); const c = v._list.get_children()[0].get_children()[1]; c ? c.get_children().map(b => b.label).join(',') : 'none'")
val "$shelf_js v._toggleShare('$T/files/notes.txt'); 'x'" >/dev/null
check "Share lists the targets found on this computer" $([ -n "$targets" ] && [ "$targets" != none ] && echo 1 || echo 0) "targets=$targets"
has_share=$(val "$shelf_js String(v._list.get_children()[0].get_children()[0].get_children().some(b => b.label === 'Share'))")
val "$settings.set_boolean('shelf-share', false); 'x'" >/dev/null; wait_a_bit 0.5
hidden=$(val "$shelf_js String(!v._list.get_children()[0].get_children()[0].get_children().some(b => b.label === 'Share'))")
val "$settings.set_boolean('shelf-share', true); 'x'" >/dev/null; wait_a_bit 0.5
check "the Share button is there, and goes when shelf-share is off" $([ "$has_share" = true ] && [ "$hidden" = true ] && echo 1 || echo 0) "shown=$has_share hidden_when_off=$hidden"

# 5c. Clipboard history (off by default): the copied text, newest first, no
#     repeats, no secrets, no text over 2000 characters; a click copies it
#     again; Clear empties it; turning it off forgets it. Copies are made with
#     St's set_text in the headless shell's own clipboard.
sources="Main.extensionManager.lookup('$UUID').stateObj._sources"
entries() { val "$sources.clipboard.entries.join('|')"; }
copy() { val "const {St} = imports.gi; St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, '$1'); 'x'" >/dev/null; wait_a_bit 0.4; }
clip_text() {
    val "globalThis.__got = 'pending'; const {St} = imports.gi; St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, (c, t) => { globalThis.__got = t; }); 'x'" >/dev/null
    wait_a_bit 0.4
    val "globalThis.__got"
}
val "$settings.set_boolean('clipboard-history', true); 'x'" >/dev/null; wait_a_bit 0.5
copy 'alpha clip'; copy 'beta clip'; copy 'alpha clip'
check "copies are listed newest first, without repeats" $([ "$(entries)" = "alpha clip|beta clip" ] && echo 1 || echo 0) "entries=$(entries)"
val "const {St} = imports.gi; St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, 'x'.repeat(2001)); 'x'" >/dev/null; wait_a_bit 0.4
check "a text over 2000 characters is not kept" $([ "$(entries)" = "alpha clip|beta clip" ] && echo 1 || echo 0) "entries=$(entries | cut -c1-60)"
val "const {St} = imports.gi; const cb = St.Clipboard.get_default(); cb.get_mimetypes = () => ['text/plain;charset=utf-8', 'x-kde-passwordManagerHint']; cb.set_text(St.ClipboardType.CLIPBOARD, 'hunter2 secret'); delete cb.get_mimetypes; 'x'" >/dev/null; wait_a_bit 0.4
check "a secret marked by a password manager is not kept" $([ "$(entries)" = "alpha clip|beta clip" ] && echo 1 || echo 0) "entries=$(entries)"
val "$shelf_js v._setMode('clipboard'); 'x'" >/dev/null; wait_a_bit 0.3
rows=$(val "$shelf_js String(v._list.get_children().length)")
check "the Clipboard list shows one row per copied text" $([ "$rows" = 2 ] && echo 1 || echo 0) "rows=$rows"
val "$shelf_js v._list.get_children()[1].emit('clicked', null); 'x'" >/dev/null; wait_a_bit 0.4
got=$(clip_text)
check "a click copies the text back" $([ "$got" = "beta clip" ] && echo 1 || echo 0) "clipboard=$got"
val "$shelf_js v._clearMode(); 'x'" >/dev/null; wait_a_bit 0.3
check "Clear empties the Clipboard list" $([ -z "$(entries)" ] && echo 1 || echo 0) "entries=$(entries)"
val "$shelf_js v._setMode('files'); 'x'" >/dev/null
copy 'delta clip'
val "$settings.set_boolean('clipboard-history', false); 'x'" >/dev/null; wait_a_bit 0.4
copy 'gamma clip'
check "turning it off forgets the copies and stops reading" $([ -z "$(entries)" ] && echo 1 || echo 0) "entries=$(entries)"
check "no copied text is written to disk" $(grep -rqE "alpha clip|beta clip|delta clip|gamma clip" "$T/cache" 2>/dev/null && echo 0 || echo 1) "a copied text is in the cache folder"

# 6. The shelf survives a restart: the cache and the test files are kept.
val "global.bn.open('shelf'); $shelf_js v._pasteFiles(); 'x'" >/dev/null; wait_a_bit 1
before=$(paths)
wait_a_bit 1
"$HERE/stop.sh" >/dev/null
(BN_KEEP="cache files" "$HERE/session.sh" --fractional > /dev/null 2>&1 &)
"$HERE/wait.sh" | tail -1
wait_a_bit 2
after=$(paths)
check "the shelf is the same after a restart" $([ "$before" = "$after" ] && [ -n "$after" ] && echo 1 || echo 0) "before=$before after=$after"

echo
[ "$failures" = 0 ] && echo "all shelf checks passed" || echo "$failures shelf check(s) failed"
exit $((failures > 0))
