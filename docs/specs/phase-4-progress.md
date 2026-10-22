# Phase 4 progress

Branch `phase-4-extras`, from the phase 3 tip (`c58f8ec`). Nothing pushed.

| Item | State | Notes |
|---|---|---|
| 1. Stopwatch and Pomodoro on the Timer tab (O-F14) | done | `6362f5b` |
| 2. Preferred and ignored players (G-1.9) | done | `37c1e43` |
| 3. Buttons on notification peeks (O-F24) | done | `8c409ab` (its message was amended before the next commit) |
| Report | done | `docs/specs/phase-4-report.md`, evidence in `docs/specs/phase-4-evidence/` |

## Item 1 notes

- Modes are exclusive: starting one resets the other two. The closed notch
  shows whichever one runs or is paused (`Island._activeTimer`).
- Pomodoro runs work and break back to back, each starting when the last
  ends; a peek says "Break time" or "Back to work". Starting it is manual.
- Settings: `timer-modes` (default on), `pomodoro-work-minutes` (25),
  `pomodoro-break-minutes` (5). Switching the modes off resets the stopwatch
  and the Pomodoro.

## Item 2 notes

- Settings: `player-selection` (default on), `preferred-player` (one name
  fragment), `ignored-players` (comma-separated fragments). Matching is on the
  player's identity or bus name, case-insensitive.
- Tested with two fake players (the shipped one and a copy whose bus name and
  identity differ, made in the scratch folder so `tools/headless` is untouched).

## Item 3 notes

- Settings: `notification-buttons` (default on), up to two buttons.
- The button press is left to the button: the island checks the pointer
  hover on the buttons, because `event.get_source()` can be null for a press
  and `Clutter.Actor.contains(null)` throws.
- `notify-send -A` does not send actions in this session (its Notify call
  carries an empty actions array, although the server advertises `actions`);
  the buttons were tested with `gdbus call ... Notify` instead.
