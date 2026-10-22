# Phase 4 (information) integration report

Status: the `phase-4-info` branch (battery details panel and power-saver peek,
calendar options, Up next) is merged into `integrate-phase-4` together with
`phase-4-extras`, and the review findings for both branches are fixed, one
commit each. Nothing is pushed. `smoke.sh` printed `all checks passed` after
every commit; the final sweep ran on fresh 125% and fresh 100% sessions with
no `JS ERROR` or `CRITICAL` in the log, and the enable–disable–enable cycles
leave one notch with no doubled handlers.

## What was integrated

- `phase-4-extras` (`9fb004c`): stopwatch, Pomodoro, preferred and ignored
  players, buttons on notification peeks. Its report is
  `docs/specs/phase-4-report.md`.
- `phase-4-info` (`7780a96`): battery details panel, power-saver peek,
  calendar colours, hide-all-day, Up next on Home. One conflict in
  `src/openView.js`, resolved by hand: `TodayView(settings)` plus the extras'
  `TimerView({settings, timer, stopwatch, pomodoro})`, `import Pango` kept for
  the Up next label, `import Graphene` dropped (main's newer glow does not
  use it).

## The findings, and what was done

| # | Finding | Fix and verification |
|---|---|---|
| 1 | Two timer modes can run at once | `exclusive()` in `src/timer.js` links the three models; every start (and every resume of a paused mode) resets the peers, wherever the start comes from. The Pomodoro's inner countdown is deliberately not a peer, so phase auto-advance does not cross-reset. Verified: a paused stopwatch reset and left tick-free when a Pomodoro or countdown starts (`_tickId` 0) (`25bfab9`). |
| 2 | Pomodoro auto-starts each phase | Kept: it is what a Pomodoro is. Documented in the work row's subtitle and the README; no new key (`f8580a7`). |
| 3 | Preferred-player change surfaces a music peek | A selection change now retunes the track key without emitting `track-changed`. Discriminating test: two playing players, the non-active one preferred — the active player switched with zero `track-changed` events and no peek (`0d3c782`). |
| 4 | Hover opens the notch after a press on a notification button | The press sets `_hoverHeld`; hover waits for the pointer to leave before it can open again. Verified with a forced-hover button press: propagates to the button, the peek survives the press, and the notch does not open after the hover delay (`9f890cb`). |
| 5 | `notify-send -A` delivers no actions | Verdict: the test setup. libnotify's notify-send 0.8.8 posts an empty actions array here, while `GetCapabilities` does list `actions`. A `gdbus` Notify with an actions array works end-to-end: buttons on the peek, `ActionInvoked` with the notification's id and the pressed action on the bus, peek ends. That check is now `tools/headless/actions.sh`, all three checks pass (`3de2d37`). |
| 6 | Timer tab 190 px height at big text | No clipping at text scale 1.6 (countdown and Pomodoro modes) or at 100%; evidence shots, no code change (`8fb8b53`). |
| 7 | The new preference rows never opened | New `tools/headless/prefs.sh`: runs `prefs.js` as its own GTK app under the headless session's display with `ExtensionPreferences` stubbed, walks all five pages and screenshots each. One real defect found and fixed: the shortcuts group's description carried raw `<Super><Shift>` markup, which Pango parsed and dropped the rest of the sentence. Every row builds, binds and renders (`1f32a92`). |
| 8 | Battery details panel | Verified live: the header battery is reactive (the finding's observation does not reproduce; `battery-details` defaults on), a click opens the panel with percentage, status, time left, health, energy rate and the power-saver row, all from UPower; closing the notch closes it. `_initDetails` now filters UPower devices by their `battery_` path instead of proxying every device, and the power-profile proxy falls back to the hadess bus and object names for daemons older than GNOME 43 (`00d8a8d`). |
| 9 | Calendar options untested with events | Two fake `.source` files with colours in the session's Evolution folder plus fake events injected through the event source: each event's colour bar matches its calendar, the all-day row shows and hides with `hide-all-day-events`, switching `event-colors` off drops the colour bars, and Up next on Home names the next timed event and hides once it starts. No code change (`0bc0a60`). |
| 10 | Next-meeting countdown unfinished | Built from the uncommitted leftovers after review: `UpcomingEvents` keeps its own event source over today and tomorrow, shows "in 12 min" on the closed notch only inside the lead window (default 15 minutes, setting `meeting-lead-minutes`), re-reads each minute only while shown, clears when the event starts, sleeps otherwise (one wake to enter the window, one at midnight). Clicking opens the Today tab. Verified with fake events: outside the window hidden, inside shown, gone at start, minute cadence observed live, click path opens Today, shown flag false while open and true after close (`b716283`). |

## Evidence

In `docs/specs/integrate-phase-4-evidence/`: the five preferences pages
(prefs-general … prefs-about), the battery panel with real UPower values, the
Today tab with two fake calendars' colour bars and an all-day row, the Home
tab's Up next, the closed-notch meeting countdown, and the Timer tab at text
scale 1.6 and 100%.

## CPU

Idle closed, two 30 s windows after the first 30 s (utime+stime of the shell
process over wall-clock, one core): 0.17% and 0.13%. With a meeting countdown
active in the window: 0.10%. The countdown's cost is not measurable; it adds
one minute timer while shown and one GLib source while it sleeps.

## GNOME internals used

- `resource:///org/gnome/shell/ui/calendar.js` `DBusEventSource` (Upcoming's
  own instance) and `CalendarMessageList` (Today tab) — public shell UI
  modules, as GNOME's own calendar menu uses them.
- `org.gnome.Shell.Screenshot` for the prefs runner's page shots.
- `org.gnome.Shell.Eval` in the test scripts only (never in the extension).
- UPower and power-profiles-daemon over the system bus, both public.

## Not tested (needs the author or real hardware)

- A real pointer drag: the hover-held suppression (finding 4) is verified by
  forcing the button's hover and calling the press handler; a real pointer's
  leave-and-return was logic-reviewed, not pointer-tested.
- Real headphones / audio routing, a real screen recording, a real camera —
  untouched by this package, unchanged.
- Notifications with action buttons from real apps: exercised with gdbus
  (shape-identical to real daemons), not with a real application.
- The hadess fallback path of the power-profile proxy: this machine's
  power-profiles-daemon answers under the new UPower names already, so the
  fallback branch is code-reviewed only.
- GNOME 51 and the external monitor itself.

## Still open

- The Up next label and the meeting countdown each keep their own event
  source; one shared source could serve both (small, not urgent).
- `notify-send` cannot post actions in this environment; if a future test
  needs it, wrap the gdbus call instead.
- Shelf drag-and-drop (step 2 of the shelf plan) needs a helper window and a
  real session — author's call, per the hand-off.
