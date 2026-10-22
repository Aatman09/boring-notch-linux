# Phase 5 progress

Branch `phase5-system`, from `code-quality`. Gate: see `next-work-handoff.md`.

## Items

| # | Item | State | Commit |
|---|---|---|---|
| 1 | System monitor tab (F19), setting `show-system-tab` | gate run at 125% and 100%; committed | see `git log` |
| 2 | Synced lyrics (F17 / 1.5), setting `show-lyrics` | gate run at 125% and 100%; committed | see commit list |
| 3 | Monitor choice (F25 / 9.1), single display, setting `notch-monitor` | gate run at 125% and 100%; committed | see commit list |

## Item 1: System monitor tab

- Built: `src/sysmon.js` (sampler, 1 s, only while active), `src/systemView.js`
  (page with four columns and 30-sample St bars), tab in `src/header.js`,
  wiring in `src/openView.js` and `src/island.js`, `sources.system` in `extension.js`.
- Gate at 125%: smoke passes, actions passes, `tools/headless/system-tab.sh` passes.
- Gate at 100%: smoke passes, `system-tab.sh` passes, screenshot checked.
- CPU: closed idle 0.30% with the feature off (baseline 0.25%, same session
  type). With the tab open: about 1.7 to 1.9% against 0.43% for the notch open
  on Home, so the tab adds roughly 1.3 to 1.5 points while it is on screen.
  The split is in the report.
- Remaining doubts: see the report.

## Item 2: synced lyrics

- Built: `src/lyrics.js` (LRC parser, `LyricsService`: lookup on
  lrclib.net `/api/get` through Soup 3, JSON cache in
  `GLib.get_user_cache_dir()/boring-notch-linux/lyrics/`, two requests at most
  per track), `follow()` from `Island._syncMedia`, the lyric label in
  `src/player.js` updated on the Home tick while music plays, the setting
  `show-lyrics` (off), the prefs row in the Music page, README lines.
- Test without the internet: `tools/headless/lyrics.sh` swaps the service's
  Soup session for a fake that answers from the script (19 checks).
- Gate at 125% and 100%: lyrics.sh, system-tab.sh, smoke.sh, actions.sh pass,
  0 JS errors.
- CPU: closed notch with music playing, lyrics on 1.8 and 1.9%, lyrics off
  2.0 and 1.9%. The feature does no work while closed except one request per
  track.

## Item 3: monitor choice

- Built: `Island.monitorIndex` reads `notch-monitor` and maps the connector
  with `global.backend.get_monitor_manager().get_monitor_for_connector()`,
  falling back to the primary monitor; `_applyGeometry` places the notch on
  `Main.layoutManager.monitors[monitorIndex]`; `_deviceScale` uses
  `global.display.get_monitor_scale(monitorIndex)`; the setting relayouts.
  Prefs: a Display row in General listing "Primary display" and the
  connectors from `org.gnome.Mutter.DisplayConfig.GetCurrentState`.
- Test: `tools/headless/session2.sh` (two virtual monitors, copy of
  session.sh), `tools/headless/set-scales.py` (sets each monitor's scale),
  `tools/headless/monitors.sh [scale0 scale1]` (8 checks), `shot-at.sh`.
- Gate: monitors.sh at 100% (1 1) and 125% (1.25 1) on the two-monitor
  session; smoke, actions, system-tab, lyrics on single-monitor sessions at
  125% and 100%; 0 JS errors.
- Headless limit: the 1280x720 virtual monitor offers 1.333 as its largest
  scale, so the requested 2 became 1.333.
- CPU: closed idle 0.23 to 0.27% at 125% on one monitor (baseline 0.25%).
