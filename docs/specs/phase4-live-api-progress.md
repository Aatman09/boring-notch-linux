# Phase 4 live API: progress

Branch `phase4-live-api` from `code-quality`. Nothing is pushed.

| Item | Status | Commit |
|---|---|---|
| 1. Live-activity D-Bus API (F21) and LauncherEntry progress | done, checked with `tools/headless/activities.sh` | see the commit list in the report |
| 2. Weather on the Today tab (F13), off by default | not started | |

Item 1 notes:

- `src/activityApi.js` owns `org.gnome.Shell.Extensions.BoringNotch` while
  `allow-external-activities` is on. Methods are named `...Async` so GJS passes
  the caller's invocation (a plain method gets none).
- `src/launcherEntry.js` follows `com.canonical.Unity.LauncherEntry` the way
  Ubuntu Dock does.
- `tools/headless/activity-client.js` holds the bus name while it makes its
  calls. The extension drops a program's activities when its bus name goes, so
  a one-shot `gdbus call` cannot leave an activity on screen.
