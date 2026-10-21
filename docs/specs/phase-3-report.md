# Phase 3 report: cleanup and the boring.notch look

Status: all coding was done before this verification pass (commits `7f7a9a4`
to `c58f8ec`, see the progress file). This pass ran the verification in the
headless shell at 125% and 100% scale, took the evidence, and measured CPU. It
found no defect that needed a source change, so no `src/` commits were made.
One open item needs a decision: the art-glow edge (see "Still open"). The
closed-notch idle CPU first measured here at about 1.7% was a start-up effect;
a second measurement after review gives 0.3 to 0.5% (see the CPU section).
Nothing is pushed.

## Setup notes

- The worktree I was started in was on another branch at `a5ab5a1`. The
  phase 3 branch `phase-3-cleanup-and-look` (at `c58f8ec`) is checked out in the
  shared checkout, so I did not move it. I detached my worktree at `c58f8ec`
  to test that code. The verification commits sit on a new branch of my own,
  `phase-3-verify-haiku`, not on `phase-3-cleanup-and-look`.
- The test session directory is `/tmp/bn-test-haiku-p3`. Every new session
  wipes that directory, so the evidence was copied out of it as it was taken.

## What was built

| Item | Feature | Files | Setting (default) |
|---|---|---|---|
| A1 to A11 | Cleanup of the phase 2 review findings | see the progress file | none |
| B1 | Screen-recording live activity (red dot and elapsed time) | `src/recording.js`, `island.js` | `show-recording` (true) |
| B2 | Sound-output peek ("Headphones") | `src/audioRoute.js`, `island.js` | `show-audio-route` (true) |
| C1 | Colours from album art (bars, progress, labels) | `src/artColor.js`, `widgets.js`, `openView.js` | `art-colors` (true) |
| C2 | Glow behind the playing cover; paused cover shrinks and dims | `openView.js` | `art-glow` (true) |
| C3 | Scrolling titles and artists (`MarqueeLabel`) | `widgets.js`, `closedViews.js`, `openView.js` | `scroll-titles` (true) |
| C4 | Accent colour: off, system, custom | `style.js`, `prefs.js`, `style.css` | `accent-mode` (off), `custom-accent` (`#3584e4`) |
| C5 | Row-style volume and brightness peek | `closedViews.js` (`RowHudView`), `island.js` | `hud-style` (inline), `hud-percentage` (true) |
| C6 | Draggable HUD bar (volume; brightness where a backlight exists) | `closedViews.js`, `island.js`, `openView.js` | none (follows the HUD) |

## Verification of the Today tab (step 2)

Six fake events on today were fed by replacing `getEvents` on the live
`TodayView`'s event source: a standup, a two-line-long planning title (about
200 characters), an all-day holiday, lunch, a 90-character unbreakable word, and
a review.

- 125%: the calendar stays in place. Long titles end in an ellipsis
  (`Quarterly planning with a ...`, `Supercalifragilisticexpiali...`). All six
  events fit. Evidence `today-125.png`.
- 100%: the same result. Evidence `today-100.png`.
- Scrolling: 14 events at 125% give a scrollbar, the list scrolls, and the
  calendar does not move (screenshot `today-125-scroll.png` was taken but is not
  in the evidence folder; it looked correct).

No defect found on the Today tab.

## Feature sweep at 100% and 125% (step 3)

Each feature was triggered from the eval harness: the fake player for music
(`player.sh` with a 200 px test cover made with PIL), `Main.screenshotUI` for
recording, `global.bn._audioRoute.emit('changed', ...)` for the output peek,
`global.bn.showHud(...)` for the volume peeks, and `global.bn._settings` for
the toggles.

| Feature | 100% | 125% | What the picture shows |
|---|---|---|---|
| Recording view | `recording-100.png` | `recording-125.png` | Red dot and elapsed time in the closed notch |
| Sound-output peek | `sound-output-100.png` | `sound-output-125.png` | Headphones icon and name |
| Art colours | `art-colours-100.png` | `art-colours-125.png` | Progress bar and labels tinted from the cover (on; the off state was also checked in the session but is not in the folder) |
| Art glow and paused cover | `art-glow-100.png` (off above, on below), `paused-cover-100.png` | `art-glow-125.png`, `paused-cover-125.png` | Glow visible when on; paused cover shrinks, play icon shown |
| Scrolling titles | `scrolling-titles-100.png` | `scrolling-titles-125.png` | Title and artist cut at the peek edge, mid-scroll |
| Accent colour | `accent-100.png` | `accent-125.png` | Custom red `#e01b24`, system (the desktop's orange here), off (white); top to bottom |
| Volume peek, inline and row, percentage on and off | `hud-100.png` | `hud-125.png` | Inline with percentage; row with percentage; row without percentage (125% grid: inline with, row with, inline without) |
| Drag bar | not separately shown | not separately shown | Bar appearance is in the HUD images; a real drag was not tested (see below) |
| Today tab | `today-100.png` | `today-125.png` | See the section above |

Notes from the sweep:

- Percentage off removes the number in both styles (checked in the images).
- The custom accent recolours the HUD bar at once; the system accent follows the
  desktop accent (orange in this box).
- Art colours on tint the progress bar; off gives a white bar (checked at 100%).
- The first attempt at the HUD shots was taken 2 s after the peek started, after
  its 1.5 s timeout, so it caught the music view. The shots were redone with a
  0.4 s wait. The bad shots are not in the evidence.

## Idle and open CPU (step 4)

Method: `/proc/PID/stat` utime plus stime before and after 30 s, converted with
awk using `CLK_TCK`. Headless shell at 125% scale, one session (the 125% session
that ran the sweep). The 100% sweep was not measured.

| State | CPU over 30 s |
|---|---|
| Closed, nothing playing | 1.73% (repeat: 1.73%; after the disable/enable cycle: 1.67%) |
| Baseline, extension disabled, same session | 0.17% |
| Closed, fake player playing | 1.70% (1.80% after a close) |
| Open, playing, art glow on | 0.43% |
| Open, playing, art glow off | 0.47% |
| Recording view on (closed) | 1.23% |

Compare: phase 2 closed idle was 0.33% (`phase-2-report.md`). The phase 3 spec
asks for 0.3 to 0.6%. The figures above were taken in the session that had just
run the sweep and were first read as a regression. **They are not a steady
state.** A reviewer measured a fresh 125% session at the same commit (`c58f8ec`)
with 30 s windows: the first window after start-up 1.53% (settling), the second
0.47%, with the extension disabled 0.23%, and after enabling it again 0.30%.
So the closed notch costs about 0.1 to 0.25 points at idle, within the target.
Open, playing, it costs about 0.45% here, and the recording view about 1.2%
(a one-second tick that re-lays out the notch; not re-measured).

## Disable and enable (step 5)

- Notch closed: disable, then enable. `Main.extensionManager.lookup(...).state`
  = 1, one `boring-notch` actor, `grep -cE 'JS ERROR|CRITICAL' shell.log` = 0.
- Notch open: open the notch, disable, enable. State 1, one notch, log count 0.
- `smoke.sh` printed `all checks passed` at 125% at the start of the first two
  125% sessions, and at the end of the last session (notch closed). It was not
  run at 100%, and not before every commit: no `src/` file changed in this pass.

Earlier in the session I got a non-zero log count (about 5,800 lines). It came
from my own mistake: I kept a reference to the old notch after a disable and
called `open()` on it. The destroyed notch's open-view tick timer then ran on
disposed widgets. The live extension was not affected, and the clean runs
above show 0. This is noted under "Still open" as a small hardening point.

## Private GNOME internals used

- `Main.screenshotUI.screencast_in_progress`, the `notify::screencast-in-progress`
  signal and `Main.screenshotUI.stopScreencast()` (`src/recording.js`).
- `getMixerControl()` from GNOME's volume status code (`src/audioRoute.js`).
  Used with optional chaining (`getMixerControl()?.disconnectObject`), but the
  monitor's connect call is not guarded in the same way.
- `St.Settings.get()` and `-st-accent-color` / `-st-accent-fg-color` (system
  accent, `src/style.js`). The custom and off modes do not depend on them.
- `BarLevel` and `Slider` (`St`/shell `barLevel.js`, `slider.js`) for the HUD
  bar and the art-coloured progress bar, which use `-barlevel-active-background-color`.
- `Main.brightnessManager.globalScale` for the brightness bar (read and write).
  It is `null` on machines without a backlight and the bar then stays read-only.

## Not tested

- A real pointer drag on the HUD bar. Only the eval path was used, so the
  drag-follow logic and the no-loop check were not run here.
- A brightness write: the headless box has no backlight.
- Real headphones (output change simulated with the signal) and a real
  screen recording or screencast start (`Main.screenshotUI` flag set by hand).
- A real camera.
- The art-colour off state at 125% (checked at 100% only, not in the folder).

## Still open

1. ~~Closed idle CPU about 1.7%~~ Resolved by review: a start-up effect, steady
   state 0.3 to 0.5% (see the CPU section).
2. **Art glow edge (visual).** At 125% the glow is clipped to the cover's square,
   so its left and top edges read as a hard box against the black notch
   (`art-glow-125.png`, zoom in on the cover). This is a judgement about the look,
   not a reproducible malfunction, so I did not change it.
3. `openView.js` `startTicking()` does not check whether the view has been
   destroyed. Calling `open()` on a destroyed notch leaves a tick timer running.
   The island's own `_onDestroy()` clears its timeouts and no normal path reaches
   this, so it is low priority.
4. The HUD bar is only drawn by `barLevel`; if a `color` is missing the repaint
   throws (`color is undefined`). I saw it once, on the destroyed notch in the
   stale-reference case above. Not seen in a live session.
5. The blue dot on the Today tab and beside the clock was present throughout. I
   did not check what it signals (it looks like the unread-notifications
   indicator).
6. The sweep is one screenshot per feature and per scale; the marquee and the
   glow were checked as single frames, not as motion.
