# Phase 5 progress

Branch `phase5-system`, from `code-quality`. Gate: see `next-work-handoff.md`.

## Items

| # | Item | State | Commit |
|---|---|---|---|
| 1 | System monitor tab (F19), setting `show-system-tab` | gate run at 125% and 100%; committed | see `git log` |
| 2 | Synced lyrics (F17 / 1.5), setting `show-lyrics` | not started | |
| 3 | Monitor choice (F25 / 9.1), single display, setting `notch-monitor` | not started | |

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

Not started.

## Item 3: monitor choice

Not started.
