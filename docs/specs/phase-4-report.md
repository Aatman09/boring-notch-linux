# Phase 4 report: extras

Status: the three features are built on branch `phase-4-extras` (from the phase 3
tip `c58f8ec`), in three commits. Nothing is pushed. `smoke.sh` printed
`all checks passed` before each commit, and again at 125% and at 100% at the end.
Several things are not tested; see "Not tested" and "Doubts".

## What was built

| Feature | Files | Settings (default) |
|---|---|---|
| 1. Stopwatch and Pomodoro on the Timer tab (O-F14) | `src/timer.js` (`Stopwatch`, `Pomodoro`), `src/openView.js` (`TimerView`), `src/island.js`, `extension.js`, `prefs.js` (General, Timer group), `src/style.css`, README | `timer-modes` (on), `pomodoro-work-minutes` (25), `pomodoro-break-minutes` (5) |
| 2. Preferred and ignored players (G-1.9) | `src/media.js` (`MediaManager`), `extension.js`, `prefs.js` (Music, Players group), README | `player-selection` (on), `preferred-player` (empty), `ignored-players` (empty) |
| 3. Buttons on notification peeks (O-F24) | `src/closedViews.js` (`NotificationPeekView`), `src/island.js`, `src/style.css`, `prefs.js` (Peeks), README | `notification-buttons` (on) |

What each one does:

1. **Stopwatch and Pomodoro.** The Timer tab has three chips: Timer (the
   countdown with its presets, unchanged), Stopwatch (counts up from zero; play,
   pause, reset) and Pomodoro (25 minutes of work, then 5 of break, each starting
   when the last ends; a peek says "Break time" or "Back to work"). Starting one
   mode resets the other two. The closed notch shows whichever one runs or is
   paused, in the same live view the countdown uses. The stopwatch and the
   Pomodoro have a tick source only while running.
2. **Players.** `MediaManager` skips any player whose identity or bus name
   contains an ignored fragment, and prefers the preferred player whenever it is
   playing. Without either setting the choice is the same as before (checked by
   reading the code; see the doubts).
3. **Notification buttons.** A notification peek shows up to two of the
   notification's own actions on the right of its text. Pressing one runs the
   action (`Notification.Action.activate()`, which emits `ActionInvoked`) and ends
   the peek. The buttons are removed once the peek has faded out.

## Commits

```
8c409ab Add buttons to notification peeks          (feature 3)
37c1e43 Let the preferred player and ignored players pick the music   (feature 2)
6362f5b Add a stopwatch and a Pomodoro to the Timer tab               (feature 1)
c58f8ec Drag the HUD bar to set volume or screen brightness           (phase 3 tip)
```

Plus one commit with this report and the evidence. Before each of the three
commits, `smoke.sh` printed `all checks passed` on a session that had loaded that
code: before commit 1 after the duplicate-key fix found on the diff read, before
commit 2 after the player tests, and before commit 3 after the hover fix (the
first smoke run after that fix failed because a hover had opened the notch; a
fresh session passed). Commit `8c409ab` was amended once, only its message, to
remove a claim I had not verified.

## Evidence

Screenshots in `docs/specs/phase-4-evidence/` (cropped to the notch):

- `timer-countdown-125.png`, `timer-countdown-100.png`: the Timer tab, countdown
  mode with its presets.
- `timer-stopwatch-125.png`, `timer-stopwatch-100.png`: the Stopwatch running.
- `stopwatch-closed-125.png`, `stopwatch-closed-100.png`: the closed notch with
  the stopwatch running (stopwatch icon and elapsed time).
- `pomodoro-open-125.png`: the Pomodoro on the Timer tab, work phase.
- `pomodoro-break-peek-125.png`: the "Break time" peek after the work phase
  (phases of 1 minute were set for this run).
- `notif-buttons-125.png`, `notif-buttons-100.png`: a peek with two buttons
  ("Reply", "Mark as read").

## Acceptance checks, with the output seen

Feature 1, driven through the Timer tab's handlers in the headless shell
(`emit('clicked')` on the chips and buttons):

- Stopwatch: `started running=true mode=stopwatch`; after 3.2 s `time=0:02`;
  `paused secs=5 running=false`; 3 s later `still secs=5 running=false`;
  `resumed running=true`; `after resume secs=7`; `reset secs=0 active=false
  tick=0`. The tick source (`_tickId`) is 0 when paused and after reset.
- Stopwatch in the closed notch: the live view shows its time and icon
  (`stopwatch-closed-125.png`, `0:05`).
- Pomodoro: `pomodoro running=true phase=work label=Work time=1:00`. Closed
  view: `closed view=true live=0:57 icon=alarm-symbolic`. After 60 s:
  `phase=break secs=57 running=true sneak=true peekTitle=Break time`. Then
  `after peek phase=break secs=51 running=true sneak=false`.
- Pomodoro tick source (`_countdown._tickId`): `tick on=true paused=0
  resumed=true reset=0 active=false`.
- Modes switched off (`timer-modes` false) while a Pomodoro runs: the Pomodoro
  stops (`running=false active=false`); the chips are hidden
  (`modeRow=false mode=timer`).
- Disable then enable with the stopwatch and the Pomodoro both running:
  `1 notches=1`; afterwards `fresh stopwatch running=false pomodoro running=false
  active=null`; `JS errors: 0`.

Feature 2, two fake players (`tools/headless/fake-player.js` through
`player.sh`, and a copy of it with another bus name and identity, made in the
scratch folder). Output of `activePlayer` after each setting:

| Setting | Expected | Got |
|---|---|---|
| none, both playing | the one that changed last | Other Player |
| preferred = other | Other Player | Other Player |
| ignored = other | Test Player | Test Player |
| ignored = test,other | none | none |
| preferred = test, test paused, other playing | Other Player (playing beats paused) | Other Player |
| preferred = test, both playing | Test Player | Test Player |
| ignored = other, Test paused, selection on | Test Player | Test Player |
| same, selection off | Other Player (lists ignored) | Other Player |

Track peeks: with `ignored = other`, `Next` on the other player gives no peek
(`sneak=false`); with the list cleared the same `Next` gives a peek
(`sneak=true`, active Other Player).

Feature 3, notifications sent with `gdbus call ... Notify` (see below for why not
`notify-send -A`), and `dbus-monitor` for `ActionInvoked`:

- Two actions: the peek shows `buttons=Reply,Done`.
- Pointer press on "Reply" (virtual pointer): `string "reply"` on `ActionInvoked`;
  the peek ends (`sneak=false`); the notch stays closed; the peek's end ran once
  (`endSneakCalls=1`).
- Eval `clicked` on the second button: `string "done"` on `ActionInvoked`, the peek
  ends.
- Three actions: only `Reply,Done` are shown.
- A plain notification: no buttons, the peek shows (`buttons=0 sneak=true`).
- Setting off: `buttons=0` with two actions.
- Timeout: the buttons are gone after the peek ends (`buttons=0`).
- A press on the peek's text (not a button) still ends the peek through the
  island's own action (`sneak=false state=closed`), with no log error.

Smoke: `all checks passed` on a fresh session at 125% (after the hover fix) and at
100%; `JS ERROR`/`CRITICAL` lines in `shell.log`: 0 at both scales.

## Idle CPU

Closed notch, nothing playing, `utime+stime` from `/proc/PID/stat` over 30 s,
two readings each, 125% scale. Baseline is the phase 3 tip, extracted with
`git archive` into a scratch folder and run in its own headless session.

| Build | Readings |
|---|---|
| phase 3 tip (`c58f8ec`) | 0.83%, 0.20% |
| phase 4 (`8c409ab`) | 0.33%, 0.17% |

At 100% scale, phase 4 (`8c409ab`): 0.27%, 0.50%. The same build reads differently
from run to run (the baseline gave 0.83% and 0.20%), so the readings show no
measurable rise from the three features. No
ticking code runs while the notch is closed and idle: the stopwatch and the
Pomodoro have no source unless running, the buttons add no timers, and the
player selection only reads settings when MPRIS changes.

## Private GNOME internals used

- `Main.messageTray._showNotification` (existing override in `extension.js`, not
  new). The new code uses `Notification.actions` and `Action.label` /
  `Action.activate()` from `ui/messageTray.js`, which are exported classes.
- No new underscore members of GNOME objects are used in the new code. (The test
  scripts read `Main.messageTray._notificationQueue` and similar; those are not in
  the extension.)

## Defects found and fixed

1. A duplicate `settings,` in the `OpenView` call (found reading the diff; fixed
   before commit 1).
2. A press on a notification button also ran the peek's own action (activating
   the notification), and the button's action did not arrive (no `ActionInvoked`).
   Fixed in commit 3: the island leaves a press on a button to the button.
3. The first version of that check used `event.get_source()`. It was null for one
   press, and `Clutter.Actor.contains(null)` threw ("JS ERROR", which the smoke
   check reports). Fixed by checking the buttons' `hover` state instead.
4. A message in commit 3 said the old bug opened the Today tab. I had not verified
   that; I amended the message (`8c409ab`) to describe only what was observed.

## Not tested

- The three preferences rows, visually. `prefs.js` was only checked to parse (the
  module fails only at its shell-only import); the rows were not opened in a
  window.
- Real MPRIS players (Spotify, Firefox) and real notifications from apps that send
  actions. Only the fake players and `gdbus` notifications were used.
- `notify-send -A ... -w` as the spec asked: see the doubts.
- A 25-minute Pomodoro run to its end. Phases of 1 minute were used for the
  transition check.
- The Timer tab at a text size of 1.6 (the page height is unchanged at 190 design
  pixels; the tab was only seen at 1.25 text scaling).
- Resident notifications (where the notification is not destroyed by an action).
- Pomodoro screenshots at 100% scale: the Pomodoro shots are at 125% only.
- Click on the closed stopwatch or Pomodoro live view (behaviour unchanged from the
  countdown, not checked).

## Doubts

- **Pomodoro is automatic.** When a phase ends the next one starts at once, with a
  peek. The request did not say; a manual start for each phase is a small change in
  `Pomodoro._onFinished`.
- **Exclusivity is enforced by the tab only.** Starting one mode from the tab resets
  the others. Calling `start()` on a model directly can run two at once; the closed
  notch then shows the countdown first, then the stopwatch, then the Pomodoro (the
  order of `Island._activeTimer`). I hit this in my own test, which called the
  Pomodoro's `start()` while the stopwatch ran.
- **Switching the chip does not stop a running mode.** A stopwatch keeps running
  when the Timer chip is chosen; it stays in the closed notch.
- **Timer tab height.** The page keeps its size of 190 design pixels. At 1.25 text
  scaling the rows fit, with room to spare; at larger text sizes they may not.
- **Stopwatch timing.** Ticks come from `timeout_add_seconds`, so the first step
  of the display may come up to a second after a start. Not measured.
- **Peek with buttons.** The text gets less room (the peek is the same width), so
  its body ends sooner: "Are you there? Call me back when yo…" at 100%.
- **Pomodoro break peek and the clock.** The break peek is the existing "Done" peek
  shape, so the clock stays visible beside it (`pomodoro-break-peek-125.png`).
- **Preferred player changes can peek.** Changing the preferred player while the new
  one plays shows a music peek (the track-changed check runs). I did not decide
  whether that is wanted.
- **Preferred player field writes on every keystroke.** The entry row is bound to the
  setting directly, so each key typed re-checks the players. Cheap, not debounced.
- **`notify-send -A` sends no actions in this session.** `notify-send` reports
  "Actions are not supported by this notifications server" and sends an empty
  actions array, although the server answers `GetCapabilities` with `actions`. The
  name `org.freedesktop.Notifications` is owned by a proxy, `:1.18`, which is GNOME's
  `org.gnome.Shell.Notifications` service, and it forwards to the shell. The cause
  is not found. A `gdbus` `Notify` with actions does reach the peek, so the buttons
  were tested that way. This may affect the user's real session too; not checked.
- **Hover opens the notch after a button press.** If the pointer stays over the
  notch after a press, the existing open-on-hover opens it after the hover delay.
  Seen in a test: the notch was open a few seconds later. Not changed.
- **Stray session access.** Two evals went by mistake to `/tmp/bn-test-aries`, the
  default test directory, which is not my session (I had not set `BN_TEST_DIR` on
  those commands). Both only read state or assigned the global `global.bn` in that
  session; the first then threw on `p.start()`. Neither started, stopped or changed
  a setting there.
- **Idle CPU numbers** are two 30-second readings per build, which is about the
  noise level. They show no rise, not a precise value.
- **Pomodoro screenshots** were taken on the build after commit 1, before the
  notification and player commits. The timer view has not changed since, but they
  were not taken again.
