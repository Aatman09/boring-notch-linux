#!/bin/bash
# Checks the live-activity D-Bus API (org.gnome.Shell.Extensions.BoringNotch)
# and the LauncherEntry progress in the headless shell. Run it against a
# running session (session.sh, then wait.sh) with the notch closed. Exits
# non-zero if any check fails.
. "$(dirname "$(readlink -f "$0")")/common.sh"

failures=0
check() {   # check <name> <ok: 0 or 1> <detail>
    if [ "$2" = 1 ]; then echo "PASS  $1"; else echo "FAIL  $1  ($3)"; failures=$((failures + 1)); fi
}
val() {     # val <js>  -> the string the expression returns
    "$HERE/eval.sh" "$1" | python3 -I -c "import sys,re; s=sys.stdin.read(); m=re.match(r\"\(true, '?\\\"?(.*?)\\\"?'?\)\$\", s.strip()); print(m.group(1) if m else 'EVALFAIL ' + s.strip())"
}
wait_a_bit() { timeout "$1" tail -f /dev/null; }
errors() { grep -cE 'JS ERROR|CRITICAL|Clutter-ERROR' "$T/shell.log"; }
client() { DBUS_SESSION_BUS_ADDRESS=$(bus) gjs -m "$HERE/activity-client.js" "$@"; }
owned() {   # owned -> true or false: does the extension own the bus name
    DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session --dest org.freedesktop.DBus \
        --object-path /org/freedesktop/DBus --method org.freedesktop.DBus.NameHasOwner \
        org.gnome.Shell.Extensions.BoringNotch | grep -q true && echo true || echo false
}
activities() { val 'global.bn._sources.activities.list.map(a => a.title + " " + a.progress).join(";") || "none"'; }
launcher() { val 'global.bn._sources.launcher.list.map(a => a.title + " " + a.progress).join(";") || "none"'; }
show_peek_check() { val 'String(global.bn.peekView === global.bn._systemPeeks._activityView)'; }
setting() { env HOME="$T/home" XDG_CONFIG_HOME="$T/config" DBUS_SESSION_BUS_ADDRESS=$(bus) \
    GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set org.gnome.shell.extensions.boring-notch-linux "$1" "$2"; }

[ "$(owned)" = true ] || { echo "FAIL  the extension owns the bus name at the start"; exit 1; }
check "the extension owns org.gnome.Shell.Extensions.BoringNotch" 1 ""
val 'global.bn._clearPeeks(); "x"' >/dev/null

# 1. Start, Update, End from one program. The program stays on the bus for
#    5 s, so its activity is on screen while the checks run.
client 5 "Start:('build', 'applications-development-symbolic', 'Build', 'step 3 of 7', 0.4)" \
    "Update:('build', 'applications-development-symbolic', 'Build', 'step 4 of 7', 0.6)" > "$T/start.out" &
wait_a_bit 1.5
check "Start shows the activity" $([ "$(activities)" = "Build 0.6" ] && echo 1 || echo 0) "activities=$(activities)"
check "Update changes its progress" $([ "$(val 'String(global.bn._sources.activities.list[0].progress)')" = 0.6 ] && echo 1 || echo 0) "progress differs"
check "the closed notch shows it" $([ "$(val 'String(global.bn._live._activity !== null && global.bn._live.current() === global.bn._live._activityView)')" = true ] && echo 1 || echo 0) "not current"
check "its bar follows the progress" $([ "$(val 'String(global.bn._live._activityBar.value)')" = 0.6 ] && echo 1 || echo 0) "bar differs"
wait_a_bit 4

# 2. Peek shows a peek and times it out by itself.
client 3 "Peek:('dialog-information-symbolic', 'Peek from a script', 'Body text', uint32 1500)" > "$T/peek.out" &
wait_a_bit 1
check "Peek shows the peek view" $([ "$(show_peek_check)" = true ] && echo 1 || echo 0) "peekView differs"
wait_a_bit 2.5
check "and the peek ends by itself" $([ "$(show_peek_check)" = false ] && echo 1 || echo 0) "still showing"

# 3. End removes it.
client 3 "Start:('gone', 'dialog-information-symbolic', 'Short', '', -1.0)" "End:('gone',)" > "$T/end.out" &
wait_a_bit 1
check "End removes an activity" $([ "$(activities)" = "none" ] && echo 1 || echo 0) "activities=$(activities)"
wait_a_bit 3

# 4. Malformed calls are refused with an error, and nothing is shown.
client 1 \
    "Start:('bad-icon', '/usr/share/icons/x.png', 'T', '', 0.5)" \
    "Start:('bad-title', 'dialog-information-symbolic', '$(printf 'x%.0s' {1..81})', '', 0.5)" \
    "Start:('bad\\nid', 'dialog-information-symbolic', 'T', '', 0.5)" \
    "Peek:('dialog-information-symbolic', 'T', '$(printf 'y%.0s' {1..121})', uint32 1000)" \
    > "$T/bad.out"
check "a path as an icon is refused" $(sed -n 1p "$T/bad.out" | grep -q InvalidArgs && echo 1 || echo 0) "$(sed -n 1p "$T/bad.out")"
check "a title over 80 characters is refused" $(sed -n 2p "$T/bad.out" | grep -q InvalidArgs && echo 1 || echo 0) "$(sed -n 2p "$T/bad.out")"
check "an id with a control character is refused" $(sed -n 3p "$T/bad.out" | grep -q InvalidArgs && echo 1 || echo 0) "$(sed -n 3p "$T/bad.out")"
check "a Peek with a body over 120 characters is refused" $(sed -n 4p "$T/bad.out" | grep -q InvalidArgs && echo 1 || echo 0) "$(sed -n 4p "$T/bad.out")"
check "nothing from them is shown" $([ "$(activities)" = "none" ] && echo 1 || echo 0) "activities=$(activities)"

# 5. More than ten calls in one second: the rest are refused.
spam=()
for i in $(seq 1 200); do spam+=("Start:('spam', 'dialog-information-symbolic', 'Spam', '', 0.5)"); done
client 1 "${spam[@]}" > "$T/spam.out"
accepted=$(grep -c ': ok$' "$T/spam.out")
refused=$(grep -c TooManyCalls "$T/spam.out")
check "200 calls in a second: ten are accepted" $([ "$accepted" = 10 ] && echo 1 || echo 0) "accepted=$accepted"
check "and the other 190 are refused" $([ "$refused" = 190 ] && echo 1 || echo 0) "refused=$refused"
wait_a_bit 1.5

# 6. At most ten activities from one program.
ten=()
for i in $(seq 1 10); do ten+=("Start:('n$i', 'dialog-information-symbolic', 'N$i', '', -1.0)"); done
client 2 "${ten[@]}" "Sleep:1.2" "Start:('n11', 'dialog-information-symbolic', 'N11', '', -1.0)" > "$T/ten.out" &
wait_a_bit 2
check "an eleventh activity is refused" $(grep -q "^Start: .*TooManyActivities" "$T/ten.out" && echo 1 || echo 0) "$(tail -1 "$T/ten.out")"
wait_a_bit 2

# 7. LauncherEntry progress: shown while the app reports it, and gone when
#    it hides it, or when the app's bus name goes.
client 6 "Emit:('application://org.gnome.Nautilus.desktop', {'progress': <0.4>, 'progress-visible': <true>})" \
    "Sleep:1" "Emit:('application://org.gnome.Nautilus.desktop', {'progress': <0.7>, 'progress-visible': <true>})" > "$T/launcher.out" &
wait_a_bit 2
check "LauncherEntry progress shows as an activity" $([ "$(launcher)" != "none" ] && echo 1 || echo 0) "launcher=$(launcher)"
check "with the app's progress" $(launcher | grep -q " 0.7$" && echo 1 || echo 0) "launcher=$(launcher)"
check "and it is the activity on screen" $([ "$(val 'String(global.bn._live.current() === global.bn._live._activityView)')" = true ] && echo 1 || echo 0) "not current"
wait_a_bit 5
client 1 "Emit:('application://org.gnome.Nautilus.desktop', {'progress-visible': <false>})" > "$T/hide.out"
check "progress-visible false removes it" $([ "$(launcher)" = "none" ] && echo 1 || echo 0) "launcher=$(launcher)"
client 4 "Emit:('application://org.gnome.Nautilus.desktop', {'progress': <0.2>, 'progress-visible': <true>})" > "$T/vanish.out" &
wait_a_bit 2
check "it is shown again while its app is on the bus" $([ "$(launcher)" != "none" ] && echo 1 || echo 0) "launcher=$(launcher)"
wait_a_bit 4
check "and removed when the app's bus name goes" $([ "$(launcher)" = "none" ] && echo 1 || echo 0) "launcher=$(launcher)"

# 8. The setting that turns the API off releases the name and drops what it showed.
client 8 "Start:('off', 'dialog-information-symbolic', 'Off', '', -1.0)" > "$T/off.out" &
wait_a_bit 1.5
setting allow-external-activities false
wait_a_bit 1
check "allow-external-activities off releases the name" $([ "$(owned)" = false ] && echo 1 || echo 0) "still owned"
check "and drops the activities" $([ "$(activities)" = "none" ] && echo 1 || echo 0) "activities=$(activities)"
setting allow-external-activities true
wait_a_bit 1
check "switching it on owns the name again" $([ "$(owned)" = true ] && echo 1 || echo 0) "not owned"

# 9. Disable and enable: the name is released, then owned again.
val "Main.extensionManager.disableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 1.5
check "disabling releases the name" $([ "$(owned)" = false ] && echo 1 || echo 0) "still owned"
val "Main.extensionManager.enableExtension('$UUID'); 'x'" >/dev/null; wait_a_bit 2
check "enabling owns it again" $([ "$(owned)" = true ] && echo 1 || echo 0) "not owned"
val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); "x"' >/dev/null

# 10. Nothing above logged an error.
check "log has no JS errors or criticals" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL|Clutter-ERROR' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
