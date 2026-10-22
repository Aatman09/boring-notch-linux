#!/bin/bash
# Checks the weather on the Today tab in the headless shell. The forecast is
# faked by replacing the request function, so the checks need no network.
# A failed request is faked too; the real request is only reported, since it
# depends on the network (it printed INFO lines, not PASS or FAIL).
# Run it against a running session (session.sh, then wait.sh).
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
errors() { grep -cE 'JS ERROR|CRITICAL|Clutter-ERROR' "$T/shell.log"; }
setting() { env HOME="$T/home" XDG_CONFIG_HOME="$T/config" DBUS_SESSION_BUS_ADDRESS=$(bus) \
    GSETTINGS_SCHEMA_DIR="$REPO/schemas" gsettings set org.gnome.shell.extensions.boring-notch-linux "$1" "$2"; }
# A fake forecast: 18.4 now, high 21.2, low 12.9, rain (WMO 61).
FAKE_OK="Promise.resolve(JSON.stringify({current: {temperature_2m: 18.4, weather_code: 61}, daily: {temperature_2m_max: [21.2], temperature_2m_min: [12.9]}}))"
stub() {    # stub <js expression returning a Promise>: replaces the request
    val "global.bn._sources.weather._fetch = url => { globalThis.bnFetches = (globalThis.bnFetches ?? 0) + 1; return $1; }; 'x'" >/dev/null
}
fetches() { val 'String(globalThis.bnFetches ?? 0)'; }
row_text() { val 'global.bn._openView._today._weatherText.text'; }
row_shown() { val 'String(global.bn._openView._today._weatherRow.visible)'; }

val 'global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name === "boring-notch"); "x"' >/dev/null
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

# 1. Off by default: opening the Today tab asks for nothing and shows no line.
stub "$FAKE_OK"
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 1.5
check "off by default: nothing is requested" $([ "$(fetches)" = 0 ] && echo 1 || echo 0) "fetches=$(fetches)"
check "and the weather line is hidden" $([ "$(row_shown)" = false ] && echo 1 || echo 0) "visible=$(row_shown)"
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

# 2. On, with a location: the first open of the Today tab asks once.
setting weather-latitude 38.72
setting weather-longitude -9.14
setting weather-place Lisbon
setting show-weather true
wait_a_bit 1
check "switching it on asks for nothing until the tab opens" $([ "$(fetches)" = 0 ] && echo 1 || echo 0) "fetches=$(fetches)"
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 1.5
check "opening the Today tab asks once" $([ "$(fetches)" = 1 ] && echo 1 || echo 0) "fetches=$(fetches)"
check "the line shows the place, the temperature and the high and low" \
    $([ "$(row_text)" = "Lisbon  18°  H 21° · L 13°" ] && echo 1 || echo 0) "text=$(row_text)"
check "the weather line is visible" $([ "$(row_shown)" = true ] && echo 1 || echo 0) "visible=$(row_shown)"
check "rain is shown with the rain icon" \
    $([ "$(val 'global.bn._openView._today._weatherIcon.icon_name')" = weather-showers-symbolic ] && echo 1 || echo 0) "icon differs"
"$HERE/shot.sh" weather-today 1300 780 > /dev/null

# 3. Within 30 minutes, opening again uses the answer it has.
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 1
check "reopening within 30 minutes asks nothing" $([ "$(fetches)" = 1 ] && echo 1 || echo 0) "fetches=$(fetches)"
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

# 4. A failed request hides the line.
val "global.bn._sources.weather._fetch = () => Promise.reject(new Error('offline')); 'x'" >/dev/null
setting weather-latitude 40.42
wait_a_bit 1
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 1.5
check "a failed request hides the line" $([ "$(row_shown)" = false ] && echo 1 || echo 0) "visible=$(row_shown)"
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

# 5. The real request, for information only: it depends on the network.
val "delete global.bn._sources.weather._fetch; 'x'" >/dev/null
setting weather-latitude 41.39
wait_a_bit 1
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 8
echo "INFO  real request: line shown=$(row_shown), text=$(row_text)"
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

# 6. Switched off again: the line goes and nothing is asked.
setting show-weather false
wait_a_bit 1
val 'global.bn.open("today"); "x"' >/dev/null; wait_a_bit 1
check "switched off, the line is hidden" $([ "$(row_shown)" = false ] && echo 1 || echo 0) "visible=$(row_shown)"
val 'global.bn.close(); "x"' >/dev/null; wait_a_bit 1

check "log has no JS errors or criticals" $([ "$(errors)" = 0 ] && echo 1 || echo 0) "$(errors) lines; first: $(grep -m1 -E 'JS ERROR|CRITICAL|Clutter-ERROR' "$T/shell.log" | cut -c1-160)"

echo
[ "$failures" = 0 ] && echo "all checks passed" || echo "$failures check(s) failed"
exit $((failures > 0))
