# Spec: Phase 2, system awareness

For the agent implementing this. Read the whole document before writing code.
You do not need any other context; everything you need is here or in the repo.

## 1. Goal

Boring Notch is a GNOME Shell 50 extension (GJS, ES modules, Wayland, Ubuntu)
that puts a "Dynamic Island" in the top bar. This phase makes it react to
what the system is doing. Six features:

| # | Feature | Summary |
|---|---|---|
| F1 | Privacy dots | Coloured dots beside the clock while the microphone, camera or screen sharing is in use, and a peek naming the app. |
| F2 | Screenshot peek | A large thumbnail of the screenshot just taken, with a click to open it. |
| F3 | Bluetooth peek | "Device connected / disconnected", with the battery level when known. |
| F4 | Do Not Disturb | A moon beside the clock while DND is on, a peek when it changes, and a switch in the open notch. |
| F5 | Battery warnings | Peeks for low, critical and fully charged. |
| F6 | Keyboard peeks | Caps Lock on/off and keyboard layout changes. |

Each feature has its own setting, so a user can turn it off.

## 2. Ground rules

Break any of these and the work is rejected.

1. **Work on a branch** named `phase-2-system-awareness`, made from `main`.
   Commit in small steps, one feature per commit, with messages that say what
   changed and why. **Do not push, and do not merge.** The reviewer does that.
2. **Idle cost stays at zero.** Nothing may poll while the notch is idle. Every
   feature is driven by a D-Bus signal, a GObject signal or a file event. A
   timer may exist only while the thing it shows is on screen. Measure idle CPU
   of the shell before and after (section 6.4) and report both numbers.
3. **Clean disable.** `disable()` must undo everything `enable()` did: every
   signal (use `connectObject` / `disconnectObject`), every `GLib.timeout_add`
   (go through `Island._setTimeout` or remove it in `destroy()`), every
   `Gio.Cancellable`, every D-Bus proxy. Test enable → disable → enable.
4. **No synchronous I/O in the shell process.** No `load_contents`, no
   `Subprocess.communicate`, no blocking D-Bus calls. Async only.
5. **Private GNOME internals must be guarded.** If you touch anything starting
   with an underscore, or not exported by GNOME's JS, use optional chaining and
   turn the feature off quietly when it is missing. List each one in your report.
6. **Verify APIs against GNOME's real source.** It is extracted at
   `/home/aries/opensource/ref/shell-src/org/gnome/shell/` (look in `ui/`,
   `misc/`). Do not invent APIs. If unsure, `grep` that tree or introspect with
   `gjs -c`.
7. **Write like the surrounding code.** Read `src/island.js` and
   `src/battery.js` first. Match their naming, their comment density and
   their idioms. Comments say *why*, never *what*. No try/catch around calls
   that cannot throw. No dead code, no unused parameters, no placeholder TODOs,
   no log spam (`console.warn` only for real failures).
8. **CSS lives in `src/style.css`.** Pixel lengths there are scaled by the
   user's zoom; font sizes are rounded to whole pixels and `icon-size` snaps to
   12/16/24/32/48/64. Never put pixel values in JS style strings: they are not
   scaled. Colours are fine in JS.
9. **No personal data** in code, comments, tests or commit messages.
10. Do not touch: `tools/headless/` (except to add a script if you must),
    `docs/plans/`, `docs/ROADMAP.md`, `LICENSE`, `metadata.json`.

## 3. Codebase map

```
extension.js        enable()/disable(); builds every monitor and the Island;
                    InjectionManager overrides of GNOME internals; keybindings.
src/island.js       The notch. State machine, springs, closed views, peek queue.
src/closedViews.js  Views shown in the closed notch (ClosedView subclasses).
src/openView.js     The open notch: Header, MediaPlayer, TodayView, TimerView.
src/media.js        MPRIS.            src/battery.js    UPower.
src/downloads.js    Downloads folder. src/timer.js      Countdown timer.
src/audio.js        Audio visualizer; exports VISUALIZER_APP_ID.
src/zoom.js         Size and text scaling. src/style.js   Scaled stylesheet.
src/style.css       All styling.
prefs.js            Settings window (General, Music, Peeks, About pages).
schemas/*.xml       GSettings schema. Recompile: glib-compile-schemas schemas/
```

### 3.1 How a data source is built (follow `src/battery.js` exactly)

A source is a class extending `EventEmitter` (from
`resource:///org/gnome/shell/misc/signals.js`) in its own file, with a
`destroy()` method. `extension.js` builds it in `enable()`, passes it to
`Island` in the options object, and destroys it in `disable()` in reverse
order, after `this._island.destroy()`. Async D-Bus proxies use a
`Gio.Cancellable`, cancelled in `destroy()`.

### 3.2 The peek queue (`Island._showPeek`)

```js
this._showPeek({
    view,                 // a view already added to this._closedLayer
    apply: () => ...,     // fills the view in when this peek's turn comes
    timeout,              // ms on screen
    action: () => ...,    // optional: run when the user clicks the peek
    priority,             // Priority.MUSIC 0, STATUS 1, NOTIFICATION 2, HUD 3
    key,                  // optional: a peek with the same key replaces the
                          // one showing and restarts its time
});
```

Higher priority shows at once; lower waits its turn; peeks older than 10 s are
dropped. All six features here use `Priority.STATUS` unless stated.
`Priority` is a `const` in `island.js`; keep it there.

### 3.3 Closed views (`src/closedViews.js`)

`ClosedView` (not yet exported: export it) is a `St.BoxLayout` with `.left` and
`.right` boxes. A subclass implements:
`sideWidth(notchHeight)` (design pixels added on each side of the bare notch),
and `get showsClock()` (false for peeks, so the clock steps aside).
`IconTextView(styleClass, sideWidth, {peek: true})` with
`update({icon, iconName, title, body})` is the ready-made "icon then text" peek;
use it wherever it fits instead of writing a new view. Add each view to the
list in `Island._init` that populates `this._closedLayer`.

### 3.4 The clock box

`Island._clockBox` holds `_clockLabel` and `_unreadDot`. F1 and F4 add small
indicators here. Any change to its width must trigger `_relayout()` (the label
already does this on `notify::text` and `style-changed`).

### 3.5 Settings

Each feature adds a boolean key to the schema, a `switchRow` on the **Peeks**
page in `prefs.js`, and a line under Features in `README.md`. Read the key with
`this._settings.get_boolean(...)` at the moment of use, and react to
`changed::key` where the feature has standing UI (dots).

## 4. Tasks

Do them in this order. Each states what to build, the exact GNOME APIs
(already checked against GNOME 50), edge cases, and acceptance criteria.

### Task 0: groundwork (small)

- Export `ClosedView`.
- Add `extraHeight()` to `ClosedView` (default `0`, design pixels) and add it to
  the closed height in `Island._relayout()`. F2 needs it; the height spring
  already animates it.
- Move the list of recording apps to ignore (`org.gnome.VolumeControl`,
  `org.PulseAudio.pavucontrol`, `VISUALIZER_APP_ID`) out of `extension.js` into
  `src/audio.js` as an exported `IGNORED_RECORDING_APPS`, and use it in the
  mic-indicator override in `extension.js` and in F1.

**Done when:** the extension behaves exactly as before.

### Task F1: privacy dots

Files: new `src/privacy.js`; edit `extension.js`, `src/island.js`,
`src/style.css`, schema, `prefs.js`, `README.md`.

`PrivacyMonitor extends EventEmitter` tracks three things:

| What | API |
|---|---|
| Microphone | `getMixerControl()` from `resource:///org/gnome/shell/ui/status/volume.js`. Listen to `stream-added` / `stream-removed`; read `control.get_source_outputs()` and each `get_application_id()`. Ignore `IGNORED_RECORDING_APPS`. |
| Camera | `new Shell.CameraMonitor()`, property `cameras-in-use`, signal `notify::cameras-in-use`. |
| Screen sharing / remote recording | `global.backend.get_remote_access_controller()`, signal `new-handle`; each handle has `is_recording` and a `stopped` signal. Count live handles. See `ui/status/remoteAccess.js` lines 19-61. |

Emit `'changed'` with `{mic: string[], camera: boolean, sharing: boolean}`
whenever any of them changes, and `'started'` with `(kind, appName)` when mic or
camera goes from not-in-use to in-use. Resolve `appName` with
`Shell.AppSystem.get_default().lookup_app(`${id}.desktop`)?.get_name() ?? id`.
Snapshot the state at construction and do not emit `'started'` for things already
running when the extension starts.

Island: add a `bn-privacy` box after `_unreadDot` in `_clockBox`, holding one
`St.Widget` dot per active kind (mic orange `#ff9f0a`, camera green `#30d158`,
sharing blue `#0a84ff`), each `6px`, hidden when its kind is off. On `'started'`,
show a peek (`IconTextView` peek, icon `audio-input-microphone-symbolic` or
`camera-web-symbolic`, title `"<App> is using the microphone"` / `"... camera"`),
`key: 'privacy'`, timeout 3000, action: spawn `gnome-control-center privacy`
with `Gio.Subprocess` (async; no `communicate`).

**Edge cases:** several apps on the mic (dot stays until the last one stops, peek
only for the first); a mic stream that starts while the visualizer's own capture
runs (must not count); extension re-enabled while an app is recording (no peek).

**Setting:** `show-privacy-indicators` (default true) governs both dots and peek.

**Acceptance:**
- With a recorder running (`gst-launch-1.0 pulsesrc ! fakesink` in the test
  audio session, see 6.3), the orange dot appears within 1 s and the peek names
  the app; the dot disappears within 1 s of stopping it.
- The visualizer playing music does **not** light the dot.
- Camera and sharing: emit your monitor's `'changed'` from `eval.sh` with the
  matching payload and assert the dots; real sources cannot be faked headless.
- Screenshot of dots at 100% and 125% scale; no clipping of the clock.
- After enable → disable → enable, starting a recorder produces exactly one peek,
  not two (a leaked listener from the first instance would make two).

### Task F2: screenshot peek

Files: `src/closedViews.js`, `src/island.js`, `src/style.css`, schema, `prefs.js`, `README.md`.

GNOME posts a notification for every screenshot (`ui/screenshot.js` ~2346-2362):
source title "Screen Capture", and **`notification.gicon` is the screenshot as an
`St.ImageContent`**. Detect it with `notification.gicon instanceof St.ImageContent`
inside `Island.showNotification()`; do not match on translated text. Screen
recording notifications use a different `gicon` and must keep the normal peek.

Add `ScreenshotPeekView extends ClosedView`: shows `notification.gicon` in a
`St.Widget` with `content` set to the image and
`content_gravity = Clutter.ContentGravity.RESIZE_ASPECT`, about 160×90 design
pixels, with a small caption "Screenshot" beside it. `extraHeight()` makes the
closed notch grow downward to hold it (about 90). `sideWidth()` about 120.
Timeout 4000, `key: 'screenshot'`, priority `NOTIFICATION`, action
`notification.activate()`. When the peek ends, clear the view's `content` so the
texture is released.

**Acceptance:**
- A fake notification built in `eval.sh` with an `St.ImageContent` from a PNG
  shows the thumbnail, the notch grows and shrinks smoothly (frame times, see
  6.5), and the texture is released afterwards.
- A normal notification still shows the ordinary peek.
- Setting `screenshot-peek` off falls back to the ordinary peek.

### Task F3: Bluetooth peek

Files: new `src/bluetooth.js`; `extension.js`, `src/island.js`, schema, `prefs.js`, `README.md`.

`GnomeBluetooth` 3.0 is installed (`import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0'`;
the shell itself uses it in `ui/status/bluetooth.js`). `BluetoothMonitor` holds one
`GnomeBluetooth.Client`, snapshots which devices are connected at construction (no
peek for those), then watches `device-added`, `device-removed` and each device's
`notify::connected`. Emit `'connected'` / `'disconnected'` with
`{alias, icon: Gio.Icon, battery: number | null}`. Debounce 1 s per device: BlueZ
flaps during reconnects. Battery comes from the device's `battery-percentage`
when `battery-type` says one is reported; verify the exact semantics with
`gjs -c` against the typelib and say what you found. The client has no `destroy`:
disconnect every signal you connected and drop references.

Peek: `IconTextView` peek, `gicon` from the device icon name, title the alias,
body `"80%"` or `"Connected"` / `"Disconnected"`. `key: 'bluetooth'`, timeout 2500.

**Acceptance:**
- Emit `'connected'` from `eval.sh`: peek appears; emit twice within 1 s: one peek.
- Devices already connected at enable produce no peek (show your snapshot logic).
- Builds clean on a machine with no Bluetooth adapter (no errors in the log).

### Task F4: Do Not Disturb

Files: `src/island.js`, `src/openView.js`, `src/style.css`, schema, `prefs.js`, `README.md`.

DND is the `show-banners` key (boolean) of schema `org.gnome.desktop.notifications`
(`ui/status/doNotDisturb.js`). `show-banners = false` means DND on. Own a
`Gio.Settings` for it in `Island`; connect `changed::show-banners` with `connectObject`.

- Closed notch: a moon (`weather-clear-night-symbolic`) in `_clockBox`, shown
  while DND is on.
- Peek on change: `IconTextView` peek, `"Do Not Disturb on"` / `"off"`, `key: 'dnd'`.
- Open notch: add a toggle button to `Header` (next to the gear) bound both ways to
  the key, with a checked style (reuse `.bn-toggle`). It must also reflect
  changes made elsewhere.
- Notification peeks already stop while DND is on because GNOME stops calling
  `_showNotification`; verify rather than assume.

**Acceptance:** `gsettings set org.gnome.desktop.notifications show-banners false`
in the test session shows the moon and the peek; clicking the header toggle flips
the key; a notification sent while DND is on shows no peek.

### Task F5: battery warnings

Files: `src/battery.js`, `src/closedViews.js`, `src/island.js`, `src/style.css`, schema, `prefs.js`, `README.md`.

The UPower display device already proxied in `battery.js` has a `WarningLevel`
property (`u`: 1 none, 2 discharging, 3 low, 4 critical, 5 action). Add it to
`DeviceIface`. In the properties handler emit `'warning'` with the new level when
it rises to 3 or more, and `'full'` when `State` becomes `FULLY_CHARGED` while a
charger is connected and it was `CHARGING` before. Extend `BatterySneakView` with
a variant for low / critical (red, `bn-low` class) and full (green), with texts
"Low battery", "Critical battery", "Fully charged" and the percentage.
`key: 'battery-level'`, timeout 4000, priority `NOTIFICATION` for critical,
`STATUS` otherwise.

**De-duplicate with GNOME:** gnome-settings-daemon also posts a battery
notification. When a warning peek is showing or ended less than 2 s ago, and a
notification whose `gicon` name starts with `battery` arrives in
`showNotification`, consume it without a second peek.

**Acceptance:** `global.bn._battery.emit('warning', 3)` and `'full'` from
`eval.sh` show the right peeks; a fake battery notification right after is
swallowed, and one 5 s later is shown normally.

### Task F6: keyboard peeks

Files: new `src/keyboard.js`; `extension.js`, `src/island.js`, schema, `prefs.js`, `README.md`.

| What | API |
|---|---|
| Caps Lock | `global.stage.context.get_backend().get_default_seat().get_keymap()`; signal `state-changed`; `get_caps_lock_state()`. See `ui/shellEntry.js` 172-192. |
| Layout | `getInputSourceManager()` from `resource:///org/gnome/shell/ui/status/keyboard.js`; signal `current-source-changed`; `manager.currentSource.shortName` and `.displayName`. |

`state-changed` fires on every modifier press, so keep the handler to one boolean
comparison against the last known Caps Lock state, and emit only on a change.
Snapshot both states at construction. Peek: icon `input-keyboard-symbolic`, title
"Caps Lock on" / "Caps Lock off" or the layout short name (for example "EN"),
`key: 'keyboard'` so quick toggles update one peek, timeout 1200.

**Acceptance:** a virtual keyboard device (see `tools/headless/` and the example
in 6.5) pressing Caps Lock produces one peek per toggle; `gsettings set
org.gnome.desktop.input-sources sources "[('xkb','us'),('xkb','de')]"` followed by
activating the second source produces a layout peek; holding Shift produces none.

## 5. Settings keys to add

| Key | Default | Page row |
|---|---|---|
| `show-privacy-indicators` | true | Peeks: "Microphone, camera and screen sharing" |
| `screenshot-peek` | true | Peeks: "Screenshots" |
| `show-bluetooth` | true | Peeks: "Bluetooth devices" |
| `show-dnd` | true | Peeks: "Do Not Disturb" |
| `show-battery-warnings` | true | Peeks: "Low and full battery" |
| `show-keyboard` | true | Peeks: "Caps Lock and keyboard layout" |

Every row has a one-sentence subtitle that says what it shows and, for F1, that
it reads which apps use the microphone and camera but never records anything.

## 6. How to test

Everything runs in an isolated headless GNOME Shell started from this repo; it
never touches the user's desktop.

### 6.1 Start and stop

```sh
cd /home/aries/opensource/boring-notch-linux/tools/headless
./session.sh --fractional 2560x1440 &   # 125% scale, 1.25 text scaling
./wait.sh --scale 1.25                  # prints "state=1" when the extension loaded
./player.sh                             # fake music player (optional)
./stop.sh                               # kills the session and its children
```

Drop `--fractional` and `--scale` to test at 100%. Test **both**.

### 6.2 Drive and observe

```sh
./eval.sh 'global.bn.open("today"); "ok"'     # global.bn is the notch (an Island)
./shot.sh name 900 80                          # PNG of the top middle, prints path
./frames.sh home                               # frame times while opening a tab
```

`eval.sh` runs JavaScript inside the shell. The notch is `global.bn`; its sources
are properties such as `global.bn._battery`. Notes: there is no `await` in eval;
a statement that throws aborts the rest; `Main.notify(title, body)` sends a real
notification; log is `/tmp/bn-test-$USER/shell.log` (grep it for `JS ERROR`,
`JS WARNING`, `CRITICAL` after every test: it must be clean).

### 6.3 Audio (for F1)

```sh
./audio.sh           # PipeWire with no hardware, silent default sink
# a "recording app": run inside the session's environment
HOME=/tmp/bn-test-$USER/home XDG_RUNTIME_DIR=$(. ./common.sh; runtime_dir) \
  gst-launch-1.0 -q pulsesrc ! fakesink &
```

### 6.4 Idle cost

With the notch closed and nothing playing, read the shell's CPU time twice, 30 s
apart, from `/proc/<pid>/stat` (fields 14+15, `getconf CLK_TCK`), with the
feature enabled and with `gsettings`-disabled. Report both. Baseline is about
0.6%. A feature that raises it measurably fails.

### 6.5 Input and timing

Virtual keyboard for F6:
```js
const seat = global.stage.get_context().get_backend().get_default_seat();
const kb = seat.create_virtual_device(imports.gi.Clutter.InputDeviceType.KEYBOARD_DEVICE);
// notify_keyval(time_us, imports.gi.Clutter.KEY_Caps_Lock, Clutter.KeyState.PRESSED / RELEASED)
```
Frame times: `./frames.sh <tab>` must show a median near 16.7 ms and no frame
above 20 ms after the first open (a slow first frame is known and accepted).
For F2, record frame times while the peek opens and closes the same way
(`global.stage` `after-paint`, as in `frames.sh`).

### 6.6 Known pitfalls

- In this user's shell, `ls` is an alias that can hang a tool call. Use `/bin/ls`.
- Do not `pkill -f` patterns that match your own command line; use `stop.sh`.
- GNOME 50 removed the `affectsInputRegion` option of `addTopChrome`.
- Foreground `sleep` may be blocked in your harness; `timeout 1 tail -f /dev/null`
  works as a wait.
- zsh expands unquoted `*` and `?`; quote patterns.
- Only the schema's compiled form is read: rerun `glib-compile-schemas schemas/`
  after editing it (the headless session reads it from the repo).

## 7. Definition of done

- [ ] All six features work, each toggleable, each default on.
- [ ] Tested at 100% and 125% scale, with screenshots of each peek saved under
      `docs/specs/phase-2-evidence/` (small PNGs; no personal content).
- [ ] enable → disable → enable cycle clean (no errors, no leaked signals,
      subprocesses and proxies gone).
- [ ] Shell log has no `JS ERROR`, `JS WARNING` or `CRITICAL` lines from the
      extension in any test.
- [ ] Idle CPU before and after reported.
- [ ] Schema compiles; every key has a prefs row and a README line.
- [ ] README feature list updated; `docs/ROADMAP.md` untouched.
- [ ] `docs/specs/phase-2-report.md` written (see 8).
- [ ] Nothing pushed.

## 8. Report to hand back

A file `docs/specs/phase-2-report.md` with: what was built per feature (3 lines
each); every private GNOME internal used and its fallback; for each acceptance
bullet, the command you ran and its output; idle CPU numbers; anything you could
not test and why; anything in this spec you disagree with and what you did
instead. Be honest about gaps: a reviewer will check each claim.

## 9. How it will be reviewed

A strict review before anything is merged. Expect the reviewer to:

1. Read every changed line, and run `git diff main --stat` to look for files you
   should not have touched.
2. Grep for every `connect(`, `connectObject(`, `timeout_add`, `Subprocess`,
   `DBusProxy`, `Settings(` and check each has a matching teardown.
3. Run the whole test plan again, including the disable/enable cycle, at both
   scales, and diff the shell log for new warnings.
4. Measure idle CPU independently.
5. Check each new view for layout at both scales, with long text, and with the
   setting off.
6. Look for AI-slop: comments that restate code, defensive code for impossible
   cases, copy-pasted blocks, inconsistent naming, unused exports.
7. Check the schema, prefs and README agree.
8. Check commit history: small, honest messages, one feature each.

Findings are reported as must-fix (correctness, leaks, rule breaks) and should-fix
(style, clarity).
