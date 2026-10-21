# Phase 4 progress

Branch `phase-4-extras`, from the phase 3 tip (`c58f8ec`). Nothing pushed.

| Item | State | Notes |
|---|---|---|
| 1. Stopwatch and Pomodoro on the Timer tab (O-F14) | done | `src/timer.js` (`Stopwatch`, `Pomodoro`), Timer tab modes; commit listed in the report |
| 2. Preferred and ignored players (G-1.9) | todo | |
| 3. Buttons on notification peeks (O-F24) | todo | |
| Report | todo | `docs/specs/phase-4-report.md` |

## Item 1 notes

- Modes are exclusive: starting one resets the other two. The closed notch
  shows whichever one runs or is paused (`Island._activeTimer`).
- Pomodoro runs work and break back to back, each starting when the last
  ends; a peek says "Break time" or "Back to work". Starting it is manual.
- Settings: `timer-modes` (default on), `pomodoro-work-minutes` (25),
  `pomodoro-break-minutes` (5). Switching the modes off resets the stopwatch
  and the Pomodoro.
