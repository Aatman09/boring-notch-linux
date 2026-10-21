# Hand-off: what is left, in order, and how to do each part

For an external coding agent. Repo: `/home/aries/opensource/boring-notch-linux`
(GitHub `Aatman09/boring-notch-linux`). The extension is a GNOME Shell 50
extension (GJS ES modules, Wayland), a Dynamic Island for the top bar.

State on 2026-10-21:

- `main` = `origin/main` = commit `c298adb`: phases 0 to 3 are merged and
  pushed (peek queue, gestures, shortcuts, music peek, privacy dots, screenshot,
  Bluetooth, DND, battery, keyboard, screen recording, sound-output peek,
  album-art colours, glow, scrolling titles, accent colour, row/inline volume
  peek with a draggable bar, Today tab fixes).
- Branch `phase-4-extras` (4 commits, tip `66ce87d`, from the phase-3 tip
  `c58f8ec`): stopwatch and Pomodoro on the Timer tab, preferred and ignored
  players, buttons on notification peeks. Reviewed: loads, smoke passes.
  Not merged.
- Branch `phase-4-info` (2 commits, tip `e09e3a1`, from `c58f8ec`): battery
  details panel and power-saver peek, calendar colours, hide-all-day switch,
  "Up next" on Home. Smoke passes. Not merged. **Unfinished work that was never
  committed** (next-meeting countdown: `src/upcoming.js`, edits to `island.js`,
  `prefs.js`, the schema, `style.css`, `README.md`, and
  `docs/specs/phase-4-info-progress.md`) may still be on disk in
  `.claude/worktrees/agent-a451ea6c07a90ab37/` (a git worktree of the repo). Read
  it, do not trust it: it has not been reviewed or tested.
- Branch `phase-3-verify-haiku` is already contained in `main`.
- The installed copy on the author's desktop is a build of commit `10560c4`.

Every work package below ends with the same gate (see "Gate"). Do the packages
in order. Create one branch per package from the current `main`
(or from the merged result of the previous package), never push, never touch
`main` directly: the author decides about merging and pushing.

## Gate (every commit, every package)

Read `tools/headless/*.sh` and `docs/specs/phase-3-cleanup-and-look.md`
(sections "ground rules" and "lessons") first.

1. `export BN_TEST_DIR=/tmp/bn-test-<yourname>` before any headless script
   (several sessions can run at once; `session.sh` deletes its test folder).
   Run `glib-compile-schemas schemas` after schema changes.
2. Start a FRESH session: `tools/headless/session.sh --fractional` in the
   background (125% scale, text scale 1.25), then `tools/headless/wait.sh`
   (prints `state=1`). 100% scale: `session.sh 2560x1440` without
   `--fractional`. Drive it with `tools/headless/eval.sh '<js>'` (no `await`;
   first `global.bn = Main.layoutManager.uiGroup.get_children().find(a =>
   a.name === "boring-notch")`), screenshots with `tools/headless/shot.sh name
   [w h]` (use `1300 780` for the open notch). Wait with
   `timeout N tail -f /dev/null || true`.
3. `tools/headless/smoke.sh` with the notch CLOSED must print "all checks
   passed" (peeks do not show while the notch is open; if a peek check fails,
   check that first). The log must have no `JS ERROR` / `CRITICAL`, in
   particular no `not in the stage` errors.
4. Enable, disable, enable: exactly one notch, handler counts do not double
   (smoke checks this).
5. Idle CPU of the headless shell (pid in `$BN_TEST_DIR/shell.pid`;
   utime+stime from `/proc/PID/stat` over 30 s windows; use `awk`, not `bc`;
   ignore the first 30 s after start-up; take two windows): closed idle 0.2 to
   0.6%. A new feature may add at most 0.5 percentage points. Never report a
   regression from one reading.
6. Look at your own screenshots at 125% and 100%: text not clipped, nothing
   misaligned. Put the useful ones in `docs/specs/<package>-evidence/` (small
   PNGs).
7. Read your own diff before committing. No dead code, no unused imports, no
   inconsistent defensive `?.`. Match the surrounding comments and naming. End
   each commit message with the attribution line you are told to use.
8. Write `docs/specs/<package>-report.md` in the format of
   `docs/specs/phase-2-report.md`: what was built, evidence per acceptance
   bullet, CPU numbers, private GNOME internals used, what was NOT tested,
   open items. Report only what you observed.

Lessons that cost time before: a bare `/**` swallowed a class; `ThemedIcon` has
`names`, not `icon_name`; a class whose `_init` never stored the passed
settings made the default volume peek throw; Clutter has no `scale` property to
ease (use `scale_x` and `scale_y`); guard anything that needs a theme node
with `this.get_stage()`; `Gio.Settings` keys must exist in the schema; GNOME
Shell sources are in the shell's gresource (`find /usr -name 'libgnome-shell*.so'`
then `gresource list` / `gresource extract`), check APIs there instead of
guessing.

## WP1: integrate the two Phase 4 branches and fix their findings

Branch `integrate-phase-4` from `main`. Merge `phase-4-extras`, then
`phase-4-info` (both touch `island.js`, `openView.js`, `prefs.js`, the schema,
`style.css`, `README.md`; resolve conflicts by hand, keep both sets of
settings, do not reformat). Then fix these findings, one commit each.

From the review of `phase-4-extras`:

1. Two timer modes can run at once. `Island._activeTimer()` picks the first
   active of timer, stopwatch, pomodoro, so a running stopwatch keeps ticking
   unseen while a countdown shows. Enforce the exclusivity in the model or in
   the island (starting one stops or resets the others), not only in the Timer
   tab's chips. Test: start a stopwatch, start a countdown, check the stopwatch
   stopped and no stray timeout remains (`GLib` sources: count them in
   `disable()`).
2. The Pomodoro auto-starts each following phase. Decide whether that is
   wanted; document it in the settings subtitle and README either way, and add
   a setting only if cheap.
3. Changing the preferred player while the new one is playing produces a music
   peek. Suppress that peek for a selection change (it is not a track change).
4. After pressing a notification button with the pointer still on the notch,
   open-on-hover opens the notch. Make the button press end the peek without
   re-opening (reset the hover timer or ignore hover until the pointer leaves).
5. `notify-send -A "Reply=reply"` does not deliver actions in the headless
   shell (the Notify call carries an empty actions array). Find out whether
   that is the test setup (`notify-send` version, `--wait`) or the shell;
   test real actions with `gdbus call ... org.freedesktop.Notifications.Notify`
   with an actions array and watch `ActionInvoked` with `dbus-monitor`. Add that
   test to `tools/headless/smoke.sh` or a new `actions.sh`.
6. The Timer tab page keeps its 190 px height; check at text size 1.6 and at
   100% scale for clipping.
7. The three new preference rows (players, timer modes, buttons) were never
   opened in a window. Open the preferences for real in the headless shell
   (the extension's `prefs.js` can be loaded with `gjs` by building an
   `Adw.PreferencesWindow` and calling `fillPreferencesWindow` with a stub
   `ExtensionPreferences`, or run `gnome-extensions prefs` inside the headless
   session's D-Bus) and take screenshots of every page. Fix any row that throws
   or binds a missing key.

From the review of `phase-4-info`:

8. The battery details panel: the header battery's `reactive` was false in the
   headless shell. Verify a click opens the panel, that it shows percentage,
   state, time to full or empty, energy rate and health, that it closes when
   the notch closes, and that missing data (no battery, no profile service) just
   leaves rows out. `BatteryMonitor._initDetails` creates a proxy for every
   UPower device; filter by path (`/battery_`) instead. Verify the power-profile
   service name on Ubuntu 26.04 (`org.freedesktop.UPower.PowerProfiles` or
   `net.hadess.PowerProfiles`; try both).
9. Calendar options: test with fake events (override the event source's data
   from `eval.sh`): colours per calendar, hide all-day, "Up next" on Home. The
   all-day events and the colour dots were not exercised in the headless shell.
10. Finish the next-meeting countdown (plan `docs/plans/other-notch-apps.md`
    F8): a closed-notch live activity "in 12 min" for the next event inside a
    configurable window (default 15 min), updated once a minute only while shown,
    click opens the Today tab, gone when the event starts, setting
    `show-meeting-countdown`. Start from the uncommitted `src/upcoming.js` if it
    is still there, after reading it. Test with fake events.

Acceptance: gate passes on the merged branch; reports for both merged branches
exist (`phase-4-report.md` exists for extras; write `phase-4-info-report.md`).

## WP2: the blur at 100% scale

Follow `docs/specs/sharpness-at-100-percent.md` exactly (branch
`fix-sharpness-100`). This is the author's most visible complaint on the
external monitor (2560x1440 at 100%). Do it before the new features.

## WP3: harden the tests

Branch `harden-smoke`. Extend `tools/headless/smoke.sh` (it must still finish in
about one minute) so that every feature that once broke is covered:

- Volume peek, inline and row styles: `global.bn.showHud(new
  Gio.ThemedIcon({name: "audio-volume-high-symbolic"}), null, 0.6, 1)` returns
  true and leaves no log error (this once threw because `InlineHudView` never
  stored its settings).
- Screen recording view appears and disappears
  (`Main.screenshotUI._screencastInProgress` + `notify("screencast-in-progress")`).
- Sound-output peek via `global.bn._audioRoute.emit("changed", ...)`.
- Music peek with a fake player that closes mid-load (`player.sh`,
  `fake-player.js`): no `player is null` in the log.
- Today tab opens with fake events at both scales, no error.
- A check that every settings key used by `prefs.js` and `src/*.js`
  (`get_boolean('...')` etc.) exists in the schema (grep both; this has caught
  real bugs).
- Timer, stopwatch, Pomodoro and notification-button paths after WP1.

Also add `tools/headless/soak.sh`: run the shell for N minutes (default 20)
with the fake player, repeated peeks, open/close cycles and enable/disable
every minute; sample the shell's RSS and the number of file descriptors every
30 s; fail if either grows monotonically by more than a set threshold; print
a table. This is a leak test; slow leaks make a shell sluggish over days and
nobody has measured this yet.

## WP4: compliance with extensions.gnome.org (read-only report first)

Branch `ego-review`. Read GNOME's extension review guidelines (the
"Review Guidelines" page on gjs.guide) and check the code against each rule:
no unnecessary subprocess (the visualizer's `gst-launch-1.0` is allowed only if
well-justified: document it), no private API without a guard, everything undone
in `disable()` (signals, timeouts, subprocess, injections, keybindings,
D-Bus watches, settings connections), no minified or generated code, license,
`metadata.json` complete, no clipboard or network use without a switch, no use
of `St.Settings` or other globals that are not restored. List every violation
with file and line in `docs/specs/ego-review.md`; fix the cheap ones in
separate commits; leave judgement calls to the author. Do NOT submit anything.

## WP5: new features (each its own branch and report)

Order by value and risk. The plans in `docs/plans/` have the GNOME API,
files, settings, tests and risks for each; read the section named.

1. **D-Bus live-activity API** (`other-notch-apps.md` F21): any app or script
   can post a live activity (icon, title, progress, id, priority) and updates
   or ends it, plus real progress from Unity `LauncherEntry` signals. Own bus
   name owned only while enabled; every name, subscription and timeout undone
   in `disable()`. Validate input strictly (this is an IPC surface):
   length-limited strings, known icon names only, rate limit. Test with
   `gdbus call` and `dbus-send`, a script that posts 100 updates in a second,
   and malformed calls.
2. **Weather** (F13), off by default (network): needs a keyless provider
   (Open-Meteo); location from a setting, not geoclue by default; cache; no
   request while the notch has never been opened.
3. **Shelf, step 1** (`boring-notch-gaps.md` 5.1): a tab holding files from
   paste, finished downloads and screenshots; open, reveal, remove, drag-less.
   Store paths only, never copy; survive restart (GSettings strv or a JSON in
   the extension's cache dir); handle missing files.
4. **Quick Share from the shelf** (5.4), off unless a handler exists (GSConnect,
   Bluetooth, LocalSend, `xdg-email`).
5. **Clipboard history** (F18), OFF by default, text only, limited length and
   count, a password-manager heuristic (skip entries flagged
   `x-kde-passwordManagerHint` / concealed), clear button; it reads the
   clipboard, so the settings subtitle must say so.
6. **System monitor tab** (F19): samples only while the tab is open.
7. **Synced lyrics** (G-1.5, F17), OFF by default: sends the track name to
   `lrclib.net`; cache on disk; the setting's subtitle says so.
8. **Monitor choice** (G-9.1, F25): choose which display shows the notch,
   then optionally all displays. This interacts with WP2 (per-monitor scale):
   do it after WP2.

Do not start the shelf's drag-and-drop (step 2): GNOME Shell sees drags but
cannot receive files, it needs a helper window and a real session; leave it
for the author to decide.

## WP6: release

Branch `release-1.1`. Only after WP1 to WP3 are merged by the author:

- `CHANGELOG.md` for v1.1 (what changed since v1.0, grouped by phase).
- Refresh the README feature list and screenshots from the evidence folders;
  a short GIF or MP4 of the main features using `tools/headless/frames.sh`.
- `metadata.json` version bump; do NOT add GNOME `51` to `shell-version`
  without testing on a real GNOME 51 session (the author has none; ask).
- Build the zip with `git archive` + `gnome-extensions pack` from a clean
  checkout of the tag, never from a working tree with uncommitted files (that
  once shipped half-written code to the author's desktop).
- Prepare the GitHub release notes; do not publish.

## Things that need the author, not an agent

A real pointer drag on the volume bar, real headphones, a real screen
recording, a real camera, real notifications with action buttons from real
apps, GNOME 51, the external monitor itself. Say plainly in every report which
of these you could not test.
