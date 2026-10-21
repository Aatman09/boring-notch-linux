# Phase 4 live API report

Branch `phase4-live-api` from `code-quality`. Nothing pushed.

## What was built

1. **Live-activity D-Bus API and LauncherEntry progress (F21).**
   - `src/activityApi.js` owns `org.gnome.Shell.Extensions.BoringNotch` at
     `/org/gnome/Shell/Extensions/BoringNotch` while `allow-external-activities`
     is on. Methods: `Start`, `Update` (same arguments, both upsert), `End`,
     `Peek`.
   - Checks: id 1 to 64 characters, no control characters; icon `[a-z0-9-]+`
     up to 64; title 80; detail and body 120; progress clamped to 0..1, any
     negative or non-number is -1 (none); at most 10 activities per sender;
     10 calls per second per sender, the rest refused with
     `TooManyCalls`; Peek timeout clamped to 1000..10000 ms.
   - Refusals are D-Bus errors returned to the caller. Nothing is logged.
   - `src/launcherEntry.js` subscribes to `com.canonical.Unity.LauncherEntry.Update`
     and `NameOwnerChanged`. Progress comes from `progress` and
     `progress-visible`; the app name and icon come from `Shell.AppSystem` by
     the desktop id. An unknown app shows its desktop id and a generic icon.
   - `src/liveActivities.js` shows the most recent activity in the closed
     notch, with its icon, title, a thin bar when progress is 0 or more, and
     `+N` for the others (or the detail when it is alone). Priority: below the
     recording, timer and meeting countdown, above the downloads count.
   - Peeks from `Peek` go through `SystemPeeks` (`_onActivityPeek`), when the
     notch is closed.
   - Settings: `allow-external-activities` (default true), `show-app-progress`
     (default true). Prefs rows under Information > Live activities. README
     lines added.
   - Teardown: the bus name is unowned, the export is unexported, the
     NameOwnerChanged subscription is removed, and the activities are dropped.
2. **Weather on the Today tab (F13), off by default.**
   - `src/weather.js` (`WeatherSource`) asks Open-Meteo with `Soup` 3
     (async, 10 s timeout), `timezone=auto`, when the Today tab opens. It asks
     at most every 30 minutes, keeps the last answer in memory, and drops
     answers for a location that has since changed.
   - Settings: `show-weather` (false), `weather-latitude`, `weather-longitude`
     (doubles with ranges), `weather-place` (string). Both coordinates zero
     means unset, and nothing is asked.
   - The Today tab shows `Place  18°  H 21° · L 13°` with a WMO-mapped
     symbolic icon under the calendar; the row is hidden when there is no
     answer.
   - Prefs: switch and location rows under Information > Weather.

Commits (newest last):

- `3697cd3` Show live activities from other programs and app progress in the closed notch
- `a3921ce` Show the current weather and today's high and low on the Today tab

## Evidence per check

Activity API (`tools/headless/activities.sh`, last run all PASS, 0 JS errors):
- Start shows the activity; Update changes progress and the bar follows it: PASS
- Peek shows the peek view and times out by itself: PASS
- End removes an activity: PASS
- A path as icon, a title over 80 characters, an id with a newline, a body
  over 120 characters are refused with InvalidArgs; nothing is shown: PASS
- 200 calls in one second: 10 accepted, 190 refused with TooManyCalls: PASS
- An eleventh activity is refused with TooManyActivities: PASS
- LauncherEntry progress shows as an activity with the progress; the closed
  notch shows it; progress-visible false removes it; it is removed when the
  sender's bus name goes: PASS
- allow-external-activities off releases the name and drops the activities; on
  owns it again: PASS
- Disable releases the name, enable owns it again: PASS
- Log: no JS ERROR, CRITICAL or Clutter-ERROR: PASS

Weather (`tools/headless/weather.sh`, last run all PASS except the INFO line):
- Off by default: nothing requested, line hidden: PASS
- Switched on: nothing requested until the Today tab opens; then one request:
  PASS
- Text and rain icon from a faked forecast: PASS
- Reopen within 30 minutes asks nothing: PASS
- A failed request hides the line: PASS
- Switched off hides the line: PASS
- Real request (INFO only): the network was reachable, the answer came back
  and the line showed it.
- Log: no errors: PASS

Regression gate:
- `tools/headless/smoke.sh` (notch closed): all checks passed, several runs.
- `tools/headless/actions.sh`: all checks passed.
- Enable, disable, enable: exactly one notch (smoke check).
- Preferences: `tools/headless/prefs.sh` opened all five pages; the run log had
  no errors. The screenshots show only the top of each page.

Screenshots (`docs/specs/phase4-live-api-evidence/`):
- `activity-closed-progress.png` (125%): "Build" with its bar and the detail.
- `activity-closed-100.png` (100%): same at 2560x1440.
- `weather-today-100.png` (100%): the Today tab with the weather line under
  the calendar.
- A 125% weather screenshot was taken, but the test folder was wiped by a
  later session start before it was copied, so it is not in the folder.

## CPU

Closed notch, idle, headless shell, 30 s windows (utime+stime):
- 125% session with the API and weather code, no activity: 0.17%, 0.30%
  (first build), then 0.23%, 0.23% (after both features).
- 100% session with weather on, one progress activity shown earlier: 0.83% in
  the first window (right after an activity client ended), then 0.13%.

Not measured: a baseline run of `code-quality`. A baseline session was started
from a `git archive` copy, but the test folder went missing and it was
stopped. So the "at most 0.5 points" rule is not checked against a baseline.

## Not tested

- Preferences rows were not seen at their own scroll position (only the top of
  each page was screenshotted). The new groups were built without errors.
- The weather line at 125% after the last CSS change (max-width) was not
  re-shot.
- Real LauncherEntry from a real browser or Nautilus. The test used a
  persistent gjs client that emits `com.canonical.Unity.LauncherEntry.Update`.
- Ubuntu Dock running alongside (it owns `com.canonical.Unity` itself); the
  signal subscription is independent of that.
- Network failure through Soup itself (DNS or HTTP error). The failure path was
  tested with a rejected stub only. An attempt to force a failure with a proxy
  environment variable did not work: the request went through.
- Long titles in the activity view (up to 80 characters): no ellipsis
  was set; only short titles were looked at.

## Doubts

- A LauncherEntry activity hides the downloads count while it is shown. A
  Nautilus copy therefore hides a browser download count in the same moment.
- A browser that leaves `progress-visible` true after completion would show a
  stuck 100% activity. Chrome and Firefox were not tested.
- `Start` and `Update` both upsert; an `Update` for an unknown id creates it.
  The spec did not say.
- The test client holds the bus name because a one-shot `gdbus call` would drop
  its activity at once. The spec's `gdbus call` examples therefore show nothing
  on screen unless the caller stays on the bus.
- Weather location: both coordinates zero means unset, so a real place at
  (0, 0) cannot get weather.
- Weather place name stays whatever was typed; the test changed coordinates
  without changing the name, so the INFO line showed "Lisbon" for Barcelona
  coordinates.
- Weather refresh happens only when the Today tab opens, so an open Today tab
  is not refreshed after 30 minutes until it is reopened.
- A transient gjs `Clutter-ERROR` (a label with natural width 0 in a horizontal
  box) aborted the shell once during development; it was removed and the
  error grep now also matches `Clutter-ERROR`.
- Schema default for `weather-place` is `''`; `weather-latitude`/`longitude`
  are doubles with ranges, so out-of-range values are refused by GSettings.
