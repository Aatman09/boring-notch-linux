# Features from other notch / Dynamic Island apps: plan for Boring Notch (GNOME 50)

Scope: features found in notch apps **other than boring.notch** that this extension does not have yet. Each one comes with a GNOME/Linux data source checked against the GNOME Shell 50 sources (`~/opensource/ref/shell-src/org/gnome/shell/`, cited as `ui/...:line`) and against the typelibs installed on this machine. It also gets a build plan for this codebase, risks, effort and value.

Date: 2026-10-20. Machine: GNOME Shell 50.1, Ubuntu.

---

## 0. What the extension already does

So we don't propose things it has:

- **Closed notch:** the clock and an unread dot. The live activities, in priority order (`Island._currentClosedView`), are: peek, then timer, then downloads, then music (art + bars).
- **Peeks** (`Island._showSneak`, a single slot that the newest peek replaces):
  - volume/brightness HUD (`InlineHudView`, from the `_showOsdWindow` injection)
  - notifications (from the `_showNotification` injection)
  - battery plug/unplug
  - download finished
  - timer done
- **Open notch tabs:** Home (MPRIS player), Today (`CalendarMessageList` + `Calendar` + `DBusEventSource` events), Timer (presets 1–25 min).
- **Things it already covers indirectly, which I won't propose again:**
  - **Every OSD that goes through `Main.osdWindowManager`.** That includes `gsd-media-keys` OSDs sent over D-Bus `ShowOSD` (`ui/shellDBus.js:130-151`): mic mute key, airplane-mode key, touchpad toggle, keyboard backlight. It also covers Mutter's `show-osd` (`ui/windowManager.js:885`). They already appear as the inline HUD, but they get the generic look (icon + label) and no custom treatment.
  - **Every GNOME notification**, including:
    - GSConnect phone notifications and SMS (GSConnect turns them into GNOME notifications)
    - the "“App” is ready" attention notifications (`ui/windowAttentionHandler.js:11-12`)
    - the "Screenshot captured" notification, whose `gicon` is the screenshot texture (`ui/screenshot.js:2350-2358`)
  - **Fullscreen hiding:** `addTopChrome(..., {trackFullscreen: true})`.

**Cost rule this plan follows.** The README measures 0.6% idle CPU with "nothing polls when idle". Every feature below is designed to be signal-driven when closed. Anything that has to poll (system monitor, meeting countdown ticks) polls only while it is visible, the same way `OpenView.startTicking` and `_syncVisualizer` do.

---

## 1. Survey: what other apps have

### macOS

| App | Notable features beyond media/HUD | Source |
|---|---|---|
| **DynamicNotch** (jackson-storm) | Live activities: Now Playing with tinted progress bar, downloads, AirDrop, timer, **screen recording**, **Focus mode**, **Personal Hotspot**, lock screen. HUDs: **charging / low battery / full battery**, **Bluetooth connect**, **Wi-Fi**, **VPN**, Focus off, "No Internet". **Synced lyrics (LRCLIB, lyrics.ovh fallback)**. Swipe-to-dismiss gestures, floating-capsule mode for non-notch screens, display selection | https://github.com/jackson-storm/dynamicnotch |
| **Atoll** (Ebullioscopic, GPL-3) | Live activities: media, Focus, screen recording, **privacy indicators**, downloads, charging. **System stats** (CPU/GPU/mem/net/disk/temp). **Clipboard history**, **color picker**, calendar + **reminders** preview, **file Shelf**. Lock screen widgets (media, timers, charging, Bluetooth devices, weather via Open-Meteo). Gestures: two-finger swipe open/close, horizontal swipe on music = skip / ±10 s seek. Remappable shortcuts. Minimal vs standard mode | https://github.com/Ebullioscopic/Atoll |
| **NotchNook** (lo.cafe) | **File tray + AirDrop drop zone** (drag a file to the notch), calendar widget, **"Mirror" webcam preview**, Shortcuts launcher, rearrangeable widgets | https://www.macworld.com/article/2406934/notfhnook-macbook-dynamic-island-widgets-files-tray.html, https://setapp.com/apps/notchnook |
| **Alcove** | Instant notifications, live activities, swipe gestures, customizable HUDs, **upcoming calendar event alerts**, lock screen presence | https://tryalcove.com/, https://www.macstories.net/reviews/alcove-an-excellent-notch-utility-with-beautiful-animations/ |
| **DynamicLake Pro** | **Call live activities for FaceTime/Zoom/Meet/Teams**, DynaGlance day overview with **weather + schedule**, timer, DynaDrop/DynaClip file tools, **DynaConnect Bluetooth device alerts**, DynaKeys system function keys, **DynaSwitcher app switcher** | https://thesweetbits.com/tools/dynamiclake-review/ |
| **MediaMate** | Volume/brightness/keyboard-brightness HUD themes (iOS, circular, notch), **per-display style**, now-playing bubble, **audio output device icons (AirPods)** | https://wouter01.gumroad.com/l/mediamate, https://www.macstories.net/reviews/notchnook-and-mediamate-two-apps-to-add-a-dynamic-island-to-the-mac/ |
| **NotchDrop** (Lakr233, MIT) | **Drop files onto the notch to stash them**, AirDrop, auto-cleanup after 1 day (configurable), one-click open, option-click delete | https://github.com/Lakr233/NotchDrop |
| **Notchmeister** (Iconfactory) | Purely cosmetic **hover effects** under the notch (Glow, Cylon, Plasma Leak, Nano Radar). Draws a fake notch on non-notch Macs | https://apps.apple.com/app/id1599169747 |
| **TopNotch** | Hides the notch by blacking out the menu bar. Not relevant: the GNOME top bar has no hardware notch | (no feature overlap) |

### iPhone Dynamic Island / Live Activities

Source: https://www.macworld.com/article/1069195/iphone-14-pro-dynamic-island-features-apps.html, https://maketecheasier.com/dynamic-island-iphone/

- **Ongoing live activities:**
  - phone/FaceTime calls (with duration), timers, stopwatch, Now Playing, Maps turn-by-turn
  - third-party ActivityKit: sports scores, Uber/food delivery, flight status
  - Voice Memos and screen recording
  - Personal Hotspot, SharePlay, AirPlay
- **Transient system alerts:**
  - Face ID unlock, Apple Pay
  - AirPods/accessory connect with battery, charging / low battery
  - **silent mode switch**, Focus changes
  - Shortcuts running, AirDrop, NFC/CarKey, Watch unlock, Find My
  - privacy dots (mic = orange, camera = green), Airplane mode, SIM alerts
- **Linux mapping:**
  - *Has a desktop data source:* calls (VoIP via the mic-in-use app, phone via GSConnect), timers/stopwatch, recording, hotspot (NetworkManager AP mode), accessory connect (BlueZ, USB mounts), charging/low battery (UPower), silent/mute (already via the volume OSD), Focus (GNOME Do Not Disturb), "Shortcuts running" (a custom D-Bus activity API), privacy dots, airplane mode (already via the OSD).
  - *No desktop source without third-party web APIs:* navigation, sports, deliveries, Face ID, Apple Pay. These could only arrive through a generic **live-activity D-Bus API** (F21) that user scripts feed.

### Linux / Windows

| Project | Features | Source |
|---|---|---|
| **NexNotch** (NexVar, GNOME 49+, GPL-3) | Tabs:<br>• **System**: CPU/RAM/temp/net/disk/load from /proc and hwmon, 1 s loop<br>• **Calendar & Google Tasks** via GOA + libecal<br>• **dual-city Weather** (wttr.in)<br>• **Pomodoro** with presets + JSONL log + **Stats** (week chart, streak)<br>• **Notes**<br>• **Shelf** (file picker + Super+Shift+D + optional Drive upload)<br>• **Quick**: mic/camera indicators, Bluetooth battery, keyboard layout, DND toggle, power actions<br>Also a notification peek. It notes that **Wayland blocks drag-and-drop from Nautilus onto the notch**. It shells out to `pactl`, `fuser` and `upower` every 15 s (the EGO reviewer flagged sync IO) | https://github.com/NexVar/NexNotch, https://extensions.gnome.org/review/70221 |
| **Dynamic Island** (HIMURAw) | Frosted island with clock/date/battery. Click opens a control centre (**Wi-Fi, Bluetooth, Quick Settings toggles and sliders, open apps**). Notifications in the island, media bubble, auto-hide when a window touches it | https://github.com/HIMURAw/gnome-dynamic-island, https://extensions.gnome.org/review/75738 |
| **Dynamic Music Pill** (Andbal23) | MPRIS pill in the panel or dock. **Colours from album art**, visualizer modes (incl. real-time via cava), **configurable click/scroll actions**, compact mode, player allow/ignore filters, fallback art, **synced lyrics** | https://github.com/Andbal23/dynamic-music-pill, https://www.omgubuntu.co.uk/2026/04/lyrics-feature-dynamic-music-pill-extension |
| **Quickshell islands** (Tide-island, k4) for Hyprland/niri | Media, notifications, launcher, plugin API | https://aur.archlinux.org/packages/tide-island |
| **DynamicWin** (Windows) | Media, calendar (Google), **file tray**, **Bluetooth view** | https://github.com/FlorianButz/DynamicWin |
| **WinIsland** (Windows) | Notification takeover, media sessions, **Pomodoro, reminders** | https://github.com/lb-li/WinIsland |
| Windowsland, Venu, NotNotch | Clock, **CPU monitor**, charging animation; Google Calendar; file tray | https://github.com/FrigonTech/WindowslandOverlay, https://bbalduzz.gumroad.com/l/notnotch |

The same features keep coming up: **privacy indicators**, **Bluetooth/AirPods connect with battery**, **low/full battery**, **Focus/DND**, **screen recording**, **Wi-Fi/VPN/No-internet**, **file shelf**, **clipboard history**, **system stats**, **weather**, **next-event alert**, **Pomodoro**, **lyrics**, **gestures**, **album-art tint**.

---

## 2. Shared groundwork, done once before most features

These two changes make the features below cheap and safe.

### G1. A peek queue with priorities (S, needed once there are more than about 3 new peeks)

**Problem.** `_showSneak` overwrites the current peek. With Bluetooth, Wi-Fi, DND, caps lock, workspace and similar peeks, a burst of them would flicker. Resume from suspend is a typical burst: Wi-Fi reconnects, Bluetooth reconnects and the battery state changes at once.

**Steps:**
1. In `src/island.js`, replace `_sneak`/`_sneakAction` with `this._peeks = []` holding `{view, timeout, action, priority, key}`.
2. Add `showPeek({view, timeout, action, priority = 0, key})`. If a peek with the same `key` is showing, update it in place and restart its timeout, as the HUD needs for repeated volume presses. Otherwise insert it by priority. Show the head only.
3. `_endSneak` pops the head and shows the next one.
4. Priorities: HUD 3 (instant feedback), notifications 2, system peeks (Bluetooth/Wi-Fi/DND/battery) 1, cosmetic (workspace/layout) 0. Peeks below priority 3 are dropped when they are more than ~5 s stale.
5. Keep `showHud`/`showNotification` signatures so `extension.js` is unchanged.

**Test.** In the headless session, run `sh-eval.sh 'global.bn._battery.emit("plugged", true); global.bn.showHud(...); "ok"'` and screenshot at 0.2 s and 2 s to see them in order.

### G2. A generic "system peek" view and a source registry (S)

Most new peeks are "icon + title + optional detail + optional level". Reuse `IconTextView` (already used for the timer, downloads and messages), or add `StatusPeekView(icon, title, detail, {level, accent})` in `src/closedViews.js`.

Constructor arguments are already growing (`settings, zoom, media, battery, timer, downloads, audio, artCache, ...`). Change `Island` to take `sources` (an object) and add new monitors there. Each monitor lives in `src/<name>.js` and follows the existing `EventEmitter` + `destroy()` pattern (`battery.js`, `downloads.js`).

**Template for every feature below:**
- **New file** `src/foo.js`: `export class FooMonitor extends EventEmitter { constructor(); destroy(); }` using `connectObject` / `disconnectObject` and a `Gio.Cancellable` for async proxies (as in `battery.js`).
- **`extension.js`:**
  - `enable()`: `this._foo = new FooMonitor()` and pass it into `Island`.
  - `disable()`: `this._foo.destroy(); this._foo = null;` in reverse construction order. **After** `this._island.destroy()`, as the existing code does.
- **`src/island.js`:**
  - `foo.connectObject('changed', ..., this)` in `_init`. Disconnection happens automatically because `connectObject` ties to the island's destroy.
  - For live activities, add an entry to `_currentClosedView` and to `_relayout` through `sideWidth()`.
- **Schema:** add a key `show-foo` (b) to `schemas/org.gnome.shell.extensions.boring-notch-linux.gschema.xml`, then run `glib-compile-schemas schemas`.
- **`prefs.js`:** add `activities.add(switchRow(settings, 'show-foo', ...))`. The page will want splitting into "Live activities" / "Peeks" / "Tabs" groups once more than ~10 rows exist.
- **Headless test:**
  1. `start-headless.sh`, then `wait.sh`, then `setup.sh`.
  2. Trigger the event: fire the monitor's signal through `sh-eval.sh`, or trigger the real source.
  3. Capture with `shot.sh name`.
  4. Check `session/shell.log` for JS errors.
  5. Toggle the extension off and on through `sh-eval.sh 'Main.extensionManager.disableExtension(uuid); Main.extensionManager.enableExtension(uuid)'` to catch leaks.
- **Note: system-bus sources need fakes.** `start-headless.sh` only isolates the **session** bus (`dbus-run-session`). UPower, BlueZ, NetworkManager and power-profiles live on the **real system bus**. To fake them:
  - Start a private `dbus-daemon --system`-style bus with `dbus-daemon --config-file=/usr/share/dbus-1/session.conf --print-address` and export it as `DBUS_SYSTEM_BUS_ADDRESS` before `gnome-shell`.
  - Run `python-dbusmock` templates on it: `upower`, `bluez5`, `networkmanager`, `power_profiles_daemon`.
  - python-dbusmock is **not installed**. Use `uv run --with python-dbusmock python -I -m dbusmock --template upower` in a separate scripts directory.
  - The other option is to emit the monitor's JS signals directly through `sh-eval.sh`. That is cheaper but does not test the D-Bus parsing.
- **Cost measurement for every feature:** idle CPU of `$(cat shell.pid)` over 60 s, read from `/proc/<pid>/stat` utime+stime, closed notch, feature enabled versus disabled. The target is no measurable change, staying at about 0.6%.

---

## 3. Candidate features

Each feature lists: **What / who has it**, **GNOME mapping (verified)**, **Implementation**, **Risks**, **Effort / Value**.

### F1. Privacy indicators: mic / camera / screen-share dots in the closed notch

- **What / who.**
  - **What it shows:** orange/green dots like iOS, beside the clock. A peek names the app the first time ("Firefox is using the microphone").
  - **Who has it:** Atoll ("privacy indicators"), NexNotch Quick tab, iPhone, DynamicLake (Zoom/Meet/Teams call activities).
- **Mapping (verified):**
  - **Camera.** `Shell.CameraMonitor` with property `cameras-in-use` (`ui/status/camera.js:16-18`). Public Shell API, PipeWire-based, signal-driven.
  - **Mic.** Gvc mixer from `getMixerControl()` (exported, `ui/status/volume.js:22`), with `stream-added` / `stream-removed` and `get_source_outputs()` and each output's `get_application_id()`. This is the same logic the extension already overrides in `_maybeShowInput` (`extension.js`), so it must skip `VISUALIZER_APP_ID` too.
  - **Screen sharing / remote recording.** `global.backend.get_remote_access_controller()` with the `new-handle` signal. A handle has `is_recording` and `stopped` (`ui/status/remoteAccess.js:19-61`, `:159-177`). Handles that already exist at enable time can't be enumerated through public API. The fallback is `Main.panel.statusArea.screenSharing?.visible` (`ui/panel.js:426-427`), which is a private-ish but stable status-area role name.
- **Implementation:**
  1. New `src/privacy.js`, `PrivacyMonitor`:
     - construct `new Shell.CameraMonitor()` and connect `notify::cameras-in-use`
     - connect the mixer's `stream-added` / `stream-removed`
     - connect the controller's `new-handle`
     - emit `'changed'` with `{mic: [appIds], camera: bool, sharing: bool}`
  2. `src/island.js`:
     - add a `bn-privacy-dots` box in `_clockBox` after `_unreadDot`, with two 6 px dots styled in `style.css`
     - on a mic/camera false→true transition, show a peek (G1 priority 1) with the app name, resolved through `Shell.AppSystem.get_default().lookup_app(id + '.desktop')?.get_name()`
     - clicking the peek opens Settings → Privacy (`gnome-control-center privacy`)
  3. Schema key `show-privacy-indicators` (b, default true) and a prefs row.
  4. `disable()`: `privacy.destroy()` disconnects everything. `CameraMonitor` is GC'd after `run_dispose()`.
  5. **Test.** In the headless shell, start a mic stream from the host: `gst-launch-1.0 pulsesrc ! fakesink` runs with the PipeWire session, so check `audio-session.sh` / `pw.sh`, which already start a PipeWire for the visualizer test. Then screenshot. Camera: the CameraMonitor can't be faked headless. Unit-test by emitting `notify::cameras-in-use` through `sh-eval`.
- **Risks:**
  - **CPU:** nothing; signal-driven.
  - **Duplication:** GNOME already shows the same icons in the panel's right side. Make the dots optional, and consider them most useful when the clock is in the notch.
  - **Visualizer:** the visualizer's own capture must be excluded or the dot lights up whenever music plays.
- **Effort S–M. Value high:** a recognisable iPhone feature, and it doubles as the "call" activity.

### F2. Bluetooth device connect / disconnect peek with earbud battery

- **What / who.** "AirPods connected · 80%". Who has it: DynamicNotch (Bluetooth HUD), DynamicLake (DynaConnect), Atoll (Bluetooth widget), NexNotch, iPhone.
- **Mapping (verified):**
  - **Client.** `GnomeBluetooth.Client` (typelib `GnomeBluetooth-3.0` installed; shell uses it in `ui/status/bluetooth.js:1-6,49`). Use `get_devices()` (a `Gio.ListStore`), `device-added` / `device-removed`, and per-device `notify::connected` (`bluetooth.js:88-97,194`).
  - **Battery.** The device object has `battery-percentage`, `battery-level` and `battery-type` properties (confirmed in `libgnome-bluetooth-3.0.so` strings), filled from BlueZ `Battery1` / UPower.
  - **Fallback.** UPower `EnumerateDevices` gives devices of type headset/mouse/keyboard with `Percentage`; `upower` is present.
- **Implementation:**
  1. New `src/bluetooth.js`, `BluetoothMonitor`:
     - `this._client = new GnomeBluetooth.Client()`
     - snapshot the connected set at start, so already-connected devices don't peek on enable or login
     - on a `notify::connected` change, emit `('connected'|'disconnected', {alias, icon, battery})`
     - debounce by 1 s, because BlueZ flaps during reconnects
  2. Island: `showPeek` with `StatusPeekView({gicon: device.icon, title: alias, detail: battery ? \`${battery}%\` : 'Connected'})`, timeout 2500 ms.
  3. Optional: show connected-device batteries in the open-notch header next to the laptop battery (`Header._syncBattery` in `openView.js`).
  4. Schema `show-bluetooth` and a prefs row.
  5. **Test.** Run the dbusmock `bluez5` template on a private system bus (G2 note) and call `AddDevice` / `ConnectDevice`. Or `sh-eval.sh 'global.bn._bluetooth.emit("connected", {...})'`.
- **Risks:**
  - **CPU:** none; signal-driven.
  - **Duplicate client:** a second `GnomeBluetooth.Client` duplicates the shell's object-manager client. That costs a few hundred KB, which is acceptable.
  - **Battery data:** battery is only reported for devices exposing the Battery profile. AirPods on Linux often report nothing without extra BlueZ experimental flags, so degrade gracefully.
- **Effort S–M. Value high:** very noticeable for headphone users.

### F3. Audio output device switch peek

- **What / who.** "Now playing on: Headphones / HDMI / AirPods". Who has it: MediaMate (output device icons), iPhone AirPlay route.
- **Mapping (verified).** `getMixerControl()` (`ui/status/volume.js:22`). Gvc `MixerControl` emits `active-output-update` and has `get_default_sink()`; each `MixerUIDevice` / stream has `get_description()` and `get_icon_name()`. The shell's `OutputStreamSlider` already uses the mixer this way in `volume.js`.
- **Implementation:**
  1. Add to `src/media.js` or a new `src/audioRoute.js`: connect `active-output-update`, ignore the first one after enable, and emit `'route-changed', {name, iconName}`.
  2. Island peek with the device icon and name. Merge with F2 under one G1 `key: 'audio-route'`, so a Bluetooth headset connect plus the route switch becomes one peek.
  3. Schema `show-audio-route`.
  4. **Test.** In the headless PipeWire session, run `pactl load-module module-null-sink sink_name=test2` and `pactl set-default-sink test2`.
- **Risks:** none for CPU. Devices without descriptions show raw names.
- **Effort S. Value medium.**

### F4. Low-battery, critical and fully-charged peeks

- **What / who.** Who has it: DynamicNotch (low/full battery HUD), iPhone, Atoll.
- **Mapping (verified).** The UPower DisplayDevice the extension already proxies (`src/battery.js`) also has `WarningLevel` (u: 1 none, 3 low, 4 critical, 5 action) and `State` 4 = fully charged. GNOME's own power notification comes from gsd-power and already arrives as a notification peek. A dedicated peek looks better, with a red bar and the percentage.
- **Implementation:**
  1. `battery.js`:
     - add `<property name="WarningLevel" type="u" access="read"/>` to `DeviceIface`
     - in `g-properties-changed`, emit `'warning'` when `WarningLevel` rises
     - emit `'full'` when `State` becomes `FULLY_CHARGED` while plugged in
  2. Island: reuse `BatterySneakView` with a `bn-low` style class, timeout 4000 ms, G1 priority 2.
  3. Schema `show-battery-warnings`.
  4. **Test.** Use the dbusmock `upower` template (`SetDeviceProperties` with `WarningLevel=3`), or `sh-eval.sh 'global.bn._battery.emit("warning", 3)'`.
- **Risks:** gsd-power also posts a notification, so you'd get the peek twice. Drop gsd-power's "Battery low" notification inside the `_showNotification` hook when this peek is on: match `notification.source?.title === 'Power'` or the battery icon. That match is brittle, so keep both and only de-duplicate when they arrive within 2 s.
- **Effort S. Value medium-high:** every laptop user sees it.

### F5. Do Not Disturb / "Focus" indicator and peek

- **What / who.** A moon glyph beside the clock while DND is on, plus a peek when it is toggled. Who has it: DynamicNotch (Focus activity), Atoll (Focus), iPhone (Focus change), NexNotch (DND toggle).
- **Mapping (verified).** `new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'})` with key `show-banners` (`ui/status/doNotDisturb.js:16-18`, `ui/messageTray.js:215,231`). The message tray already skips `_showNotification` when banners are off, so notification peeks pause on their own.
- **Implementation:**
  1. Island: own a `Gio.Settings` for that schema and connect `changed::show-banners`.
  2. Toggle `bn-dnd-icon` (`weather-clear-night-symbolic` or `notifications-disabled-symbolic`) in `_clockBox`.
  3. Peek "Do Not Disturb on/off".
  4. Add a DND toggle button to the Today tab header beside the notification list (`settings.set_boolean`). That matches GNOME's own calendar menu, which has the DND switch under the list.
  5. Schema `show-dnd`.
  6. Cleanup: `settings.disconnectObject(this)` in `_onDestroy`.
  7. **Test.** `sh-eval.sh 'new (imports.gi.Gio.Settings)({schema_id:"org.gnome.desktop.notifications"}).set_boolean("show-banners", false)'`, then screenshot.
- **Risks:** none.
- **Effort S. Value medium-high:** the Today tab currently has no DND switch at all, even though GNOME's calendar menu does.

### F6. Screen-recording live activity

- **What / who.** A red dot and elapsed time in the closed notch while GNOME's screencast runs; click to stop. Who has it: DynamicNotch, Atoll, iPhone.
- **Mapping (verified).** `Main.screenshotUI` (`ui/main.js:76,260`) has a readable GObject property `screencast-in-progress` (`ui/screenshot.js:1080-1083`) and the public method `stopScreencast()` (`:2049`). `ui/status/remoteAccess.js:91-109` uses exactly these from outside the class.
- **Implementation:**
  1. Island: `Main.screenshotUI.connectObject('notify::screencast-in-progress', () => this._syncRecording(), this)`.
  2. Add `this._recordLive = new IconTextView('bn-record-live', 52)` with `media-record-symbolic` in red and an elapsed time.
  3. Tick once per second **only while recording**, using `GLib.timeout_add_seconds`, cleared when recording stops. Store the start time from `GLib.get_monotonic_time()`.
  4. Priority in `_currentClosedView`: above the timer, because recording is the more urgent state.
  5. Click action: `Main.screenshotUI.stopScreencast()`.
  6. Schema `show-recording`.
  7. **Test.** In the headless shell, `sh-eval.sh 'Main.screenshotUI._setScreencastInProgress?.(true)'` is private, so start a real recording with `Main.screenshotUI.open()` plus the record button, or call the D-Bus `org.gnome.Shell.Screencast` (present: `gdbus introspect` works).
- **Risks:**
  - A 1 s tick while recording is negligible.
  - GNOME already has a panel stop button, so this duplicates it; keep it optional.
- **Effort S. Value medium.**

### F7. Screenshot thumbnail peek

- **What / who.** A bigger thumbnail of the shot you just took, with a click to open and an "Edit"/"Show in Files" action. Similar to macOS's floating screenshot thumbnail; Atoll and NotchNook have related shelf flows.
- **Mapping (verified).** Every screenshot path ends in `_storeScreenshot`. That covers Print Screen, `screenshot-window` and the UI, but not the D-Bus API that apps call. It posts a `MessageTray.Notification` with `gicon: content` (the screenshot as `St.ImageContent`), source title 'Screen Capture', iconName `screenshooter-symbolic` (`ui/screenshot.js:35-41,2350-2358`), and an action "Show in Files". So the existing `_showNotification` injection **already receives it**; it is just shown as a 24 px icon. The interactive UI also emits `'screenshot-taken'` with the `Gio.File` (`:1086,1974`).
- **Implementation:**
  1. In `Island.showNotification`, detect a screenshot. The source's `icon` is a `Gio.ThemedIcon` whose `get_names()` includes `screenshooter-symbolic`; this is safer than matching the translated title.
  2. Use a new `ScreenshotPeekView` that draws `notification.gicon` (`St.ImageContent`) into a 16:9 `St.Widget` with `content` set and `content_gravity: RESIZE_ASPECT`. Make it taller than the closed height, like a mini-open state about 120 px tall: add a 'peek' size class in `_relayout` similar to `OPEN_SIZES`.
  3. Click: `notification.activate()` opens the file. A second button calls `notification.actions[0].activate()` ("Show in Files"); `Notification.actions` is public (`ui/messageTray.js:377`).
  4. Timeout 4000 ms. Schema `screenshot-peek`.
  5. **Test.** In the headless shell, `sh-eval.sh 'Main.screenshotUI.open()'` cannot be driven easily. Use `imports`-free code: `const S = await import("resource:///org/gnome/shell/ui/screenshot.js"); ...captureScreenshot(...)`. Or simplest: Shell's keybinding handler. `sh-eval` can call `Main.wm` functions, or send an Eval that builds a fake `Notification` with `gicon` = an `St.ImageContent` from a PNG.
- **Risks:**
  - Large textures held in a peek. Release them on `_endSneak`.
  - Detection relies on the screenshooter icon, which is semi-private.
- **Effort S–M. Value high:** everybody takes screenshots and the result is very visible.

### F8. Next-meeting countdown live activity

- **What / who.** "Standup in 8 min" in the closed notch, starting N minutes before an event, then "Now: Standup" during it. Who has it: Alcove (upcoming event alerts), DynamicLake DynaGlance, NexNotch calendar.
- **Mapping (verified).** `Calendar.DBusEventSource` (`ui/calendar.js:207`) with `requestRange(begin, end)`, `getEvents(begin, end)` and the `'changed'` signal (`:103,122-127,369`). Events have `{id, date, end, summary}` only (`:79-85`): no location or URL, so there is no "Join" link without libecal, and **ECal/EDataServer typelibs are not installed**. The Today tab already owns one `DBusEventSource`, but the `Calendar` widget calls `requestRange` for whatever month you browse (`calendar.js:748`). The countdown needs **its own** `DBusEventSource` so its range (now → +24 h) isn't overridden.
- **Implementation:**
  1. New `src/upcoming.js`, `UpcomingEvents`:
     - `this._source = new Calendar.DBusEventSource()` and `requestRange(now, now+24h)`
     - on `'changed'`, find the first non-all-day event with `date > now - duration`
     - schedule **one** `GLib.timeout_add_seconds` to fire at `date - lead`; the lead is a schema key `meeting-lead-minutes`, default 10
     - when it fires, emit `'active'`, then tick every 60 s (every 1 s in the last minute) until `end`
     - re-request the range at midnight, using `GnomeDesktop.WallClock`'s clock change that the island already owns (cheap)
  2. Island: `_meetingLive = new IconTextView('bn-meeting-live', 90)` with a short summary plus "8m". Priority below the timer and above downloads.
  3. Peek at T-1 min with a chime (`global.display.get_sound_player().play_from_theme('message-new-instant', ...)`, as `_onTimerFinished` does). Click opens the Today tab.
  4. Schema `show-next-event` (b) and `meeting-lead-minutes` (i, 0–60), plus prefs rows.
  5. `disable()`: `upcoming.destroy()` destroys the source and removes timeouts.
  6. **Test.** The existing `cal-test.sh` already monkey-patches `getEvents`. Do the same: `sh-eval.sh 'global.bn._upcoming._source.getEvents=()=>[{date:new Date(Date.now()+5*60e3), end:new Date(Date.now()+35*60e3), summary:"Standup"}]; global.bn._upcoming._source.emit("changed")'`, then screenshot.
- **Risks:**
  - Idle cost is zero; it uses one scheduled timeout and a 60 s tick only while active.
  - The calendar server is a separate process that already runs for the clock menu.
  - No join links (see mapping).
- **Effort M. Value high:** a strong "this is useful" feature for workers and students.

### F9. Wi-Fi / VPN / "No Internet" peeks

- **What / who.** "Connected to HomeWiFi", "VPN connected", "No internet". Who has it: DynamicNotch (Wi-Fi, VPN, No Internet HUDs), HIMURAw (Wi-Fi in its control centre).
- **Mapping (verified):**
  - **Shell approach.** `ui/status/network.js:2130` uses `NM.Client.new_async` (typelib `NM-1.0` installed) and `notify::primary-connection`.
  - **Lighter option.** A full second `NM.Client` caches every NM object, which means several MB and wake-ups on every scan. Use a small `Gio.DBusProxy` on the system bus instead: `org.freedesktop.NetworkManager` at `/org/freedesktop/NetworkManager` with properties `PrimaryConnection` (o), `Connectivity` (u: 4 full, 3 limited, 2 portal, 1 none), `State`, `ActiveConnections` (ao). For each active connection, a proxy on `org.freedesktop.NetworkManager.Connection.Active` gives `Id`, `Type` and `Vpn` (b). This matches how `battery.js` already uses `makeProxyWrapper`.
- **Implementation:**
  1. New `src/network.js`, `NetworkMonitor` (async proxies plus a cancellable, like `battery.js`):
     - on `PrimaryConnection` change, emit `'connected', {id, type}`
     - on `Connectivity` dropping below 4 for more than 3 s (debounced), emit `'offline'` / `'portal'`
     - on active-connection `Vpn` up/down, emit `'vpn', {id, up}`
  2. Island peeks: network icon plus the SSID/connection id. For a portal, clicking opens `http://nmcheck.gnome.org` or `xdg-open` on the portal; GNOME itself handles the portal login window, so just a peek.
  3. Schema `show-network` and a prefs row.
  4. **Test.** Run the dbusmock `networkmanager` template on a private system bus (`AddWiFiDevice`, `AddActiveConnection`, `SetConnectivity`). Or emit through `sh-eval`.
- **Risks:**
  - NM wakes on scans, but property-changed signals for the root object only fire on real changes; acceptable.
  - Privacy: SSIDs on screen during screen sharing. Hide peeks while F1 detects screen sharing, which is a nice touch.
  - Suppress during resume bursts using G1.
- **Effort M. Value medium.**

### F10. Keyboard layout, Caps Lock and Num Lock peeks

- **What / who.** An iOS-style small HUD. Who has it: MediaMate-style HUD apps, NexNotch (keyboard layout); the task brief also asks for it.
- **Mapping (verified):**
  - **Caps/Num Lock.** `global.stage.get_context().get_backend().get_default_seat().get_keymap()`; the `Clutter.Keymap` has signal `state-changed`, `get_caps_lock_state()` and `get_num_lock_state()` (`ui/shellEntry.js:175-192`, Clutter-18.gir lines 45251/45352/45381).
  - **Layout.** `getInputSourceManager()` (exported, `ui/status/keyboard.js:828`) emits `current-source-changed` (`:490`); `currentSource.shortName` / `displayName`. Super+Space shows GNOME's `InputSourcePopup` only while held, so a peek after the switch is additive.
- **Implementation:**
  1. New `src/keyboard.js`, `KeyboardMonitor`: connect `state-changed`, compare against the last caps/num state (the signal fires on every modifier change, so filter it), and emit `'caps', on` and `'layout', {short, name}`.
  2. Island: `StatusPeekView` with `input-keyboard-symbolic` and "Caps Lock on" / "EN → DE", 1200 ms. G1 `key: 'keyboard'` so rapid toggles update in place.
  3. Schema `show-keyboard`.
  4. **Test.** `sh-eval.sh` can't press Caps Lock in a headless shell easily. Use a Clutter virtual device: `const d = global.stage.get_context().get_backend().get_default_seat().create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE); d.notify_keyval(0, Clutter.KEY_Caps_Lock, Clutter.KeyState.PRESSED); ...RELEASED`. For layouts, `getInputSourceManager().inputSources[1].activate()` after adding two sources with `gsettings set org.gnome.desktop.input-sources sources "[('xkb','us'),('xkb','de')]"`.
- **Risks:**
  - `state-changed` fires on every Shift press; the handler must be trivial (compare two bools). Negligible.
  - No privacy issue: only lock state is read, never keys.
- **Effort S. Value medium:** Caps Lock feedback is something GNOME lacks entirely.

### F11. Workspace-switch indicator in the notch

- **What / who.** Dots for workspaces with the active one highlighted, shown in the notch instead of GNOME's centre popup. Asked for in the brief; the closest analogue is DynamicLake's DynaSwitcher.
- **Mapping (verified).** `WorkspaceSwitcherPopup` is exported (`ui/workspaceSwitcherPopup.js:49`), and `WindowManager` creates one and calls `.display(index)` on keyboard switches (`ui/windowManager.js:1809-1819`). Data: `global.workspace_manager` (`n_workspaces`, `get_active_workspace_index()`, signal `active-workspace-changed` / `workspace-switched` in Meta-18.gir).
- **Implementation:**
  1. In `extension.js` `_injectIntoShell`: `this._injections.overrideMethod(WorkspaceSwitcherPopup.WorkspaceSwitcherPopup.prototype, 'display', original => function (index) { if (settings.get_boolean('workspace-in-notch') && island.showWorkspace(index)) { this.destroy(); return; } original.call(this, index); })`.
     - Destroying the popup immediately triggers its `destroy` handler, which unblocks the workspace tracker (`windowManager.js:1812-1816`). Check that this doesn't break the "prepend workspace" flag; otherwise hide the popup instead of destroying it and let its own timeout destroy it.
  2. Island: `WorkspacePeekView` builds N dots (cap at 10, then show "3 / 12"), 800 ms, G1 key `'workspace'`.
  3. Schema `workspace-in-notch` (b, default false, because some users like GNOME's popup).
  4. `disable()`: `InjectionManager.clear()` already restores it.
  5. **Test.** `sh-eval.sh 'Main.wm.actionMoveWorkspace(global.workspace_manager.get_workspace_by_index(1))'` doesn't show the popup, since only the keybinding path does. Call `Main.wm._showWorkspaceSwitcher(...)` (private) or `new (await import(".../workspaceSwitcherPopup.js")).WorkspaceSwitcherPopup().display(1)`, then screenshot.
- **Risks:**
  - It overrides a class's prototype method, but an exported one. Moderate break risk across GNOME versions.
  - Touchpad swipes don't use the popup, so only keyboard switches are covered.
- **Effort S. Value medium.**

### F12. Phone integration via GSConnect: battery, calls, and better SMS peeks

- **What / who.** Phone battery in the header, an incoming-call live activity, and SMS peeks with a reply action. iPhone's call activity and Mac Continuity are the reference; KDE Connect / GSConnect is the Linux equivalent.
- **Mapping:**
  - **Notifications.** Phone notifications and SMS already reach the notch as GNOME notifications through GSConnect, so peeks work today.
  - **Extra data.** It needs the GSConnect D-Bus service `org.gnome.Shell.Extensions.GSConnect`. It exports an `ObjectManager` with devices under `/org/gnome/Shell/Extensions/GSConnect/Device/<id>`, interface `org.gnome.Shell.Extensions.GSConnect.Device` (`Connected`, `Name`, `IconName`, `Type`), and per-device `org.gtk.Actions` where plugin state lives (battery is a stateful action).
  - **Not verified locally:** GSConnect is **not installed on this machine**. Verify with `gdbus introspect --session -d org.gnome.Shell.Extensions.GSConnect -o /org/gnome/Shell/Extensions/GSConnect -r` before building.
  - **Calls.** The telephony plugin raises notifications ("Incoming call from …") with Mute/Answer actions; a call peek can be built off those notifications (`notification.actions`).
- **Implementation:**
  1. Optional `src/phone.js`. Watch the name with `Gio.bus_watch_name`, so it is free when GSConnect is absent, and use `Gio.DBusObjectManagerClient` for devices. Read battery from the action group (`Gio.DBusActionGroup.get(...)` with `get_action_state('battery')`) and its `action-state-changed` signal.
  2. Header: a phone battery chip next to the laptop battery.
  3. In `showNotification`, recognise GSConnect telephony notifications by `notification.source` app id `org.gnome.Shell.Extensions.GSConnect`, with an id prefix such as `|call|`. Render a call peek with two buttons mapped to `notification.actions`, timeout extended to 20 s.
  4. Schema `show-phone`.
  5. **Test.** Not possible headless without a phone. Use a fake service: a gjs script on the headless session bus exporting the same ObjectManager, like `fake-player.js` does for MPRIS.
- **Risks:**
  - Depends on a third-party extension's internal D-Bus API.
  - Call notifications may be CRITICAL urgency, which the extension deliberately leaves to the GNOME banner. Revisit that rule for calls.
- **Effort M. Value medium:** high for GSConnect users, invisible to others.

### F13. Weather in the closed notch and on the Today tab

- **What / who.** The temperature plus a condition icon beside the clock (optional), and a forecast row on the Today tab. Who has it: Atoll (lock-screen weather), DynamicLake DynaGlance, NexNotch (dual-city wttr.in).
- **Mapping (verified):**
  - **Recommended: reuse GNOME's own client.** `misc/weather.js:25` exports `WeatherClient` (GWeather-4 typelib installed). It respects GNOME Weather's locations (`org.gnome.shell.weather`, `automatic-location`) and the Location privacy setting, emits `'changed'`, and exposes `info` (a `GWeather.Info` with `get_temp_summary()`, `get_symbolic_icon_name()`, `get_forecast_list()`) plus `update()` and `available` (the Weather app is installed).
  - **Avoid** `new WeatherClient()`: its constructor connects settings and the permission store with no destroy method, so it would leak on disable. Use the instance the date menu already owns: `Main.panel.statusArea.dateMenu._weatherItem._weatherClient` (`ui/dateMenu.js:552,966`). That path is private but stable.
- **Implementation:**
  1. `src/weather.js`, `WeatherSource`:
     - resolve the dateMenu client
     - `connectObject('changed')`
     - expose `{temp, icon, forecasts}`
     - call `client.update()` when the Today tab opens; the client already rate-limits through `UPDATE_THRESHOLD`
  2. Today tab: a compact forecast strip above the events list (`TodayView`), 5 hourly items as in `dateMenu.js:605-660`.
  3. Closed notch (optional): append `bn-weather` (icon + "18°") to `_clockBox`. Schema `weather-in-clock` (b, default false).
  4. Click opens GNOME Weather with `client.activateApp()`.
  5. **Test.** The headless session has no location. Set `gsettings set org.gnome.shell.weather locations` with a serialized GWeather location, or patch `client.info` through `sh-eval` and emit `'changed'`.
- **Risks:**
  - Network fetches happen through GWeather on GNOME's own schedule, so there is no extra polling.
  - It needs GNOME Weather installed for `available`.
  - It uses a private path for the client instance. Fall back to hiding the feature when the path is missing.
- **Effort S–M. Value medium-high:** glanceable and popular.

### F14. Pomodoro mode and a stopwatch for the Timer tab

- **What / who.** Work/break cycles with a long break every N cycles, a session count and a stopwatch. Who has it: NexNotch (Pomodoro + stats), WinIsland (Pomodoro), iPhone (stopwatch activity), DynamicLake (timer).
- **Mapping.** Pure JS on top of `src/timer.js` (monotonic time, a 1 s tick only while running). There is no system API. GNOME 50's `Main.breakManager` (`misc/breakManager.js:99-120`: property `state`, `next-break-due-time`, signals `break-due` / `break-finished`) is the **Wellbeing break reminder**. Show its countdown as a live activity too (F14b), where it is enabled in Settings → Wellbeing.
- **Implementation:**
  1. `timer.js`: add `mode` ('countdown' | 'pomodoro' | 'stopwatch') and a `phase` ('work' | 'break'). On `finished` in Pomodoro mode, auto-start the next phase and emit `'phase'`.
  2. `TimerView` (`openView.js`): a mode switcher row (three chips) and a "Session 2/4" label.
  3. `_timerLive` shows a work (red) or break (green) tint through a style class.
  4. Schema keys `pomodoro-work`, `pomodoro-break`, `pomodoro-long-break` and `pomodoro-cycles` (i), with prefs rows in a new "Timer" group.
  5. F14b: connect `Main.breakManager` `notify::state`. When the state is `BREAK_DUE` (`BreakState` export, `:58`), show a peek "Time for a break"; it can stay hidden when GNOME's own dialog shows.
  6. **Test.** Set work to 0.05 min through `sh-eval` (`global.bn._timer.start(3)`) and screenshot each phase.
- **Risks:**
  - None for CPU.
  - Stats persistence (NexNotch's JSONL) would add file IO. Keep it in GSettings (an `a{si}` of daily counts) or skip it.
- **Effort S (Pomodoro), S (stopwatch), S (break reminder). Value medium.**

### F15. Gestures on the closed notch: scroll for volume, swipe for track, middle-click

- **What / who.** Who has it: Atoll (two-finger swipe open/close, horizontal swipe skip/seek), DynamicNotch (vertical swipe dismiss), Dynamic Music Pill (configurable click/scroll actions).
- **Mapping (verified):**
  - **Events.** `scroll-event` on the island (it is `reactive: true` already). `Clutter.ScrollDirection.UP/DOWN/LEFT/RIGHT/SMOOTH` with `event.get_scroll_delta()`.
  - **Volume.** `getMixerControl().get_default_sink()` with `volume` and `push_volume()`, as `volume.js` `StreamSlider` does. The HUD then appears through the OSD hook if we call `Main.osdWindowManager.showOne` ourselves, or the extension calls `island.showHud` directly.
  - **Track control.** `MediaManager.activePlayer.next()` / `previous()` / `seek()` already exist.
- **Implementation:**
  1. Island `_init`: `this.connect('scroll-event', (_a, e) => this._onScroll(e))`.
     - Closed: vertical scroll changes volume in 5% steps (accumulate smooth deltas).
     - Closed with music: horizontal swipe skips track, debounced 400 ms.
     - Open on Home: horizontal scroll seeks ±10 s.
  2. Middle-click while closed: play/pause (`button-press-event`, `event.get_button() === 2`).
  3. Schema `scroll-action` (choices: 'volume' | 'none') and `swipe-tracks` (b).
  4. **Test.** Use a Clutter virtual pointer: `seat.create_virtual_device(POINTER_DEVICE).notify_scroll_discrete(t, Clutter.ScrollDirection.UP)` with the pointer over the notch (`notify_absolute_motion`), then check the HUD screenshot and the mixer volume.
- **Risks:** accidental volume changes when scrolling near the top bar. Default to on only for discrete wheel scrolls.
- **Effort S. Value high:** used dozens of times a day once known.

### F16. Album-art accent tint (bars, progress bar, notch glow)

- **What / who.** Who has it: DynamicNotch (progress bar tint), Dynamic Music Pill (colours from album art). boring.notch itself also tints, so check with the other agent to avoid overlap.
- **Mapping.** `GdkPixbuf` (available in Shell) loads the cached art file (`src/art.js` already resolves to a local URI). Downscale to 8×8 with `scale_simple` and compute a saturation-weighted average once per track, off the paint path.
- **Implementation:**
  1. `art.js`: after resolving, compute `accent` asynchronously. Use `GdkPixbuf.Pixbuf.new_from_stream_at_scale_async` on a `Gio.File.read_async` stream, at 16×16, so a big JPEG decode doesn't block. Cache the result per URL.
  2. Island: set `style: --bn-accent` equivalents. St doesn't support CSS variables, so set `this._liveMedia._visualizer.set_style(\`color: ${hex}\`)` and the slider's `-barlevel-active-background-color`.
  3. Schema `tint-from-art` (b).
  4. **Test.** Run `fake-player.js` with a known-colour PNG, then screenshot and sample pixel colours with Python PIL (as `sharp.py` does).
- **Risks:** one small decode per track change; negligible.
- **Effort S. Value medium:** looks polished.

### F17. Synced lyrics

- **What / who.** Who has it: DynamicNotch (LRCLIB + lyrics.ovh), Dynamic Music Pill (lyrics in the popover or the pill).
- **Mapping.** HTTP GET `https://lrclib.net/api/get?track_name=&artist_name=&album_name=&duration=` returns JSON with `syncedLyrics` (LRC). Use `Soup` 3 (`gi://Soup?version=3.0`, which GNOME Shell links). Time comes from `player.position` (MPRIS, already used by `MediaPlayer.tick`). Some players expose `xesam:asText` lyrics in metadata; try that first, with no network.
- **Implementation:**
  1. `src/lyrics.js`: fetch on track change only if the setting is on. Cancel on track change, cache 50 tracks in memory, and parse LRC into `[ms, line]`.
  2. Home tab: a line under the artist, updated by the existing 500 ms `startTicking` loop, so there is no new timer.
  3. Optional closed-notch display: replace the visualizer with the current line. That needs a tick while visible, so piggyback on the visualizer's animation frame, or add a 250 ms timeout only while shown.
  4. Schema `show-lyrics` (b, default **false**).
  5. **Test.** `fake-player.js` with a real title/artist when online, or stub `Soup` with a local file through `sh-eval`.
- **Risks:**
  - **Privacy:** it sends the title and artist to a third party. Off by default, with a clear prefs subtitle.
  - **Review:** the EGO review is fine with optional network use if disclosed.
  - **CPU:** the closed-notch lyric line needs a tick.
- **Effort M. Value medium:** loved by music users and invisible to others.

### F18. Clipboard history tab

- **What / who.** Who has it: Atoll (clipboard tab), DynamicLake (DynaClip); Linux users know it from the "Clipboard Indicator" extension.
- **Mapping (verified).** `global.display.get_selection()` returns `Meta.Selection` with signal `owner-changed` (Meta-18.gir lines 3845, 10733). It is signal-driven with no polling. Read text through `St.Clipboard.get_default().get_text(St.ClipboardType.CLIPBOARD, cb)` and images through `get_content(type, 'image/png', cb)`. Pasting sets the content back with `St.Clipboard.set_text` (`ui/screenshot.js:2236-2237` uses `set_content`).
- **Implementation:**
  1. `src/clipboard.js`, `ClipboardHistory`:
     - on `owner-changed` for `Meta.SelectionType.SELECTION_CLIPBOARD`, fetch the text and push it to a ring of `clipboard-size` items (default 20)
     - skip when the mime types include `x-kde-passwordManagerHint` (KeePassXC sets it) or the source is a password manager
     - memory only by default
  2. New tab `clipboard` in `TABS` (`openView.js`), `OPEN_SIZES.clipboard = {width: 640, height: 260}`. A `ClipboardView` lists items as buttons: click copies back and closes, a pin keeps an item, and a clear-all button.
  3. Keybinding: `Main.wm.addKeybinding('clipboard-shortcut', settings, Meta.KeyBindingFlags.NONE, Shell.ActionMode.NORMAL, () => island.toggle('clipboard'))`, with schema key `clipboard-shortcut` (as) defaulting to `['<Super><Shift>v']`. `disable()` calls `Main.wm.removeKeybinding`.
  4. Schema `clipboard-history` (b, default **false**) and `clipboard-size` (i).
  5. **Test.** `sh-eval.sh 'St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, "hello")'`, then open the tab and screenshot.
- **Risks:**
  - **Privacy:** passwords and tokens get copied. Off by default, memory only, with an "ignore when a password manager hint is set" filter and a clear button.
  - `owner-changed` fires on every copy, which is cheap.
  - Keyboard focus in the notch needs `Main.pushModal` handling for arrow-key navigation (bigger scope, so mouse-only first).
- **Effort M. Value medium-high:** power users ask for it a lot, though overlapping extensions exist.

### F19. System monitor tab (CPU / RAM / network / temperature)

- **What / who.** Who has it: Atoll (CPU/GPU/mem/net/disk), NexNotch (System tab), Windowsland (CPU).
- **Mapping.** `/proc/stat` (CPU jiffies), `/proc/meminfo`, `/proc/net/dev`, `/sys/class/hwmon/*/temp*_input` or `/sys/class/thermal/thermal_zone*/temp`. Read with `Gio.File.load_contents_async` (async; NexNotch was flagged for sync IO). There is no GNOME Shell API.
- **Implementation:**
  1. `src/sysmon.js`, `SystemMonitor` with `start()` / `stop()`, sampling every 1 s **only while the tab is visible**. Hook into `OpenView.startTicking` / `stopTicking` and `setTab`.
  2. New tab `system`: four small sparklines drawn with `St.DrawingArea` and Cairo, like `notchShape.js` draws, keeping 60 samples.
  3. Optional closed live activity "CPU 93%" only when above a threshold. That would need idle sampling, so skip it or use a slow 10 s sample. It is the one feature that breaks the "no idle polling" rule; leave it out.
  4. Schema `show-system-tab` (b, default false).
  5. **Test.** Open the tab in the headless shell, run `stress`-like load with `yes > /dev/null &`, screenshot, and confirm the sampler stops when the tab closes (log the timer id).
- **Risks:** about 4 small async file reads per second while open (a few µs each); none when closed.
- **Effort M. Value medium.**

### F20. File shelf, NotchDrop style

- **What / who.** Drag a file to the notch, it opens a drop zone, files are stashed and can be dragged out later. Who has it: NotchNook, NotchDrop, Atoll Shelf, DynamicLake DynaDrop, DynamicWin, NexNotch (button only).
- **Mapping (verified constraint).**
  - **What the shell gets.** It sees client drags through `Main.xdndHandler` (`ui/xdndHandler.js`): `drag-begin`, `drag-end`, and `handleDragOver` dispatch to shell actors under the pointer (`:73-110`). It **never receives the dropped data**: `Meta.Dnd` gives positions only. So a Shell actor can *react* to a file being dragged over the notch, opening it, but cannot *accept* the drop. That matches NexNotch's note that "Wayland blocks drag-and-drop from Nautilus onto the notch".
  - **Workable design.** A small helper GTK4 process owned by the extension, the same pattern Ubuntu's DING desktop-icons extension uses with a GTK app it positions, provides a real Wayland drop target.
- **Implementation:**
  1. `shelf/shelf.js` (gjs, GTK4/Adw): an undecorated window with a `Gtk.DropTarget` for `Gdk.FileList`. It lists stored URIs, and its `Gtk.DragSource` lets files be dragged out. Files are stored as *references*, not copies, unless an option copies them into `$XDG_CACHE_HOME/boring-notch/shelf/` with auto-cleanup after N days (NotchDrop).
  2. Extension:
     - on `Main.xdndHandler` `drag-begin`, if the pointer approaches the notch, open the notch on a `shelf` tab and spawn or show the helper (`Gio.Subprocess`)
     - find its `Meta.Window` through `global.display` `window-created` with a matching `wm_class`
     - `move_frame` it under the notch and `make_above()`, and hide it from the overview and alt-tab with `Meta.Window` skip-taskbar handling
     - kill the helper in `disable()`
  3. The helper reports contents over a private D-Bus name, and the notch shows a count badge.
  4. Schema `show-shelf`.
  5. **Test.** Headless DnD is hard. Test the helper on its own with `gjs -m shelf/shelf.js` in the headless Wayland session, and drive the drop with `Gtk` test utilities, or test manually in a nested `gnome-shell --devkit`.
- **Risks:**
  - The biggest and most fragile feature: a window-management dance and multi-process lifecycle.
  - EGO reviewers scrutinise spawned processes.
  - On Wayland, positioning works only because we're the compositor.
- **Effort L. Value high** for those who use it (the defining NotchNook/NotchDrop feature), but **risky**.

### F21. A public live-activity D-Bus API, plus Unity LauncherEntry progress

- **What / who.** Lets apps and scripts push their own live activities: build finished, ffmpeg progress, a delivery tracker cron job, "Shortcuts running". This is the Linux answer to iOS ActivityKit (third-party sports, delivery and ride activities).
- **Mapping:**
  - **Our own API.** Export `org.gnome.Shell.Extensions.BoringNotch` on the session bus with `Gio.DBusExportedObject.wrapJSObject`, the same technique as `fake-player.js`:
    - `Start(id, icon, title, detail, progress) → ()`
    - `Update(id, ...)`
    - `End(id)`
    - `Peek(icon, title, body, timeoutMs)`
  - **Existing standard to reuse.** `com.canonical.Unity.LauncherEntry` `Update` signals with `progress`, `progress-visible`, `count`, `urgent`. Chrome/Chromium downloads, Nautilus file operations, Transmission, Firefox and others emit it. Ubuntu Dock and Dash-to-Dock subscribe through `Gio.DBus.session.signal_subscribe(null, 'com.canonical.Unity.LauncherEntry', 'Update', ...)`; verified in `/usr/share/gnome-shell/extensions/ubuntu-dock@ubuntu.com/launcherAPI.js:14-21`. This gives **real download / copy progress bars**, which the current Downloads activity lacks: it only counts `.part` files.
- **Implementation:**
  1. `src/activityApi.js`: export the interface with `Gio.bus_own_name_on_connection` and keep an `activities` map. Emit `'changed'`.
  2. `src/launcherEntry.js`: `signal_subscribe`; map `application://foo.desktop` to `Shell.AppSystem` app icon and name. When `progress-visible`, add an activity; remove it on `progress-visible=false` or when the sender's name vanishes. Use `signal_subscribe` on `NameOwnerChanged`, as `launcherAPI.js:24` does.
  3. Island: `_customLive` (an `IconTextView` plus a thin `BarLevel` progress), with a priority below the timer. When several exist, show the most recent and a "+2" count.
  4. Merge with Downloads: when a browser sends LauncherEntry progress, show its percentage in `_downloadLive`.
  5. Schema `allow-external-activities` (b, default true) and `show-app-progress` (b).
  6. `disable()`: `Gio.bus_unown_name` and `signal_unsubscribe`.
  7. **Test.** Both are fully testable headless on the session bus:
     - `gdbus emit --session --object-path /com/canonical/unity/launcherentry/1 --signal com.canonical.Unity.LauncherEntry.Update "'application://org.gnome.Nautilus.desktop'" "{'progress': <0.4>, 'progress-visible': <true>}"`
     - `gdbus call ... org.gnome.Shell.Extensions.BoringNotch.Start ...`
- **Risks:**
  - Any local process can post activities. Low risk, the same as `notify-send`, but rate-limit to 10/s and cap the title length.
  - No CPU cost: signal-driven.
- **Effort M. Value high:** a unique feature that also fixes download progress.

### F22. Removable drive / USB mount peek

- **What / who.** "SanDisk 64 GB connected · Open · Eject". iPhone has accessory-connect alerts; DynamicLake has device alerts.
- **Mapping.** `Gio.VolumeMonitor.get()` with `mount-added`, `mount-removed` and `volume-added`, plus `mount.get_name()`, `get_symbolic_icon()`, `can_eject()` and `eject_with_operation`. GNOME Shell's autorun (`ui/components/autorunManager.js`) already uses this and shows a notification, so the peek may come twice. De-duplicate by suppressing the peek when an autorun notification follows within 1 s.
- **Implementation:** `src/mounts.js`; peek with two buttons (Open: `Gio.AppInfo.launch_default_for_uri(mount.get_root().get_uri())`; Eject); schema `show-drives`. **Test.** Headless with a loop device needs root; instead emit a fake through `sh-eval`, or use `gio mount` of an archive or SMB share.
- **Risks:** none.
- **Effort S. Value medium.**

### F23. Quick toggles row in the open notch

- **What / who.** DND, Night Light, Dark mode, power profile and "keep awake" chips. Who has it: HIMURAw (full control centre), NexNotch Quick tab, DynamicLake DynaKeys.
- **Mapping (verified):**
  - **DND:** `org.gnome.desktop.notifications show-banners` (F5).
  - **Night Light:** `org.gnome.settings-daemon.plugins.color night-light-enabled` (`ui/status/nightLight.js:29-32`).
  - **Dark mode:** `org.gnome.desktop.interface color-scheme`.
  - **Power profile:** system bus `org.freedesktop.UPower.PowerProfiles` at `/org/freedesktop/UPower/PowerProfiles`, property `ActiveProfile` (rw) and `Profiles` (`ui/status/powerProfiles.js:11-12,52,89`).
  - **Keep awake:** `org.gnome.SessionManager.Inhibit(app_id, 0, reason, flags=8 /* idle */)` through `misc/gnomeSession.js`'s SessionManager proxy. The user already has Caffeine installed, so this is optional.
- **Implementation:**
  1. A `QuickRow` in the Today tab's left column footer or the Home idle view, built from `St.Button` chips (`bn-chip`, as Timer presets are) bound to the settings above.
  2. Power-profile change peek: connect `g-properties-changed` and peek "Power Saver on". It is also the analogue of iOS Low Power mode.
  3. Schema `show-quick-toggles`.
  4. **Test.** Toggle the chips through `sh-eval` and read back the GSettings. power-profiles needs the dbusmock `power_profiles_daemon` template.
- **Risks:** it duplicates Quick Settings, so keep it to 4–5 chips.
- **Effort S–M. Value medium.**

### F24. Notification peek actions (reply / buttons)

- **What / who.** Action buttons right in the peek. Who has it: Alcove ("instant notifications"), DynamicLake, iPhone banners.
- **Mapping (verified).** `notification.actions` (`ui/messageTray.js:377`) is an array of `Action` objects (`:332`) with a `label` and an `activate()` method (`:344`). `addAction` wraps the callback so that activating it also destroys a non-resident notification (`:425-440`), which is exactly what GNOME's banner buttons do. So `action.activate()` is all a peek button needs. Inline reply isn't in GNOME's notification model (no `reply` hint since GNOME 46's model rewrite), so buttons only.
- **Implementation:**
  1. `IconTextView({peek: true})`: optional `actions` row with up to two `St.Button`s.
  2. Grow the peek height when actions exist, using a "tall peek" size in `_relayout`.
  3. Keep the peek while hovered: pause the `sneak` timeout on `notify::hover`.
  4. Schema `notification-actions` (b).
  5. **Test.** `notify-send -A yes=Yes -A no=No title body` in the headless session (`DBUS_SESSION_BUS_ADDRESS` from `session/bus`), then screenshot and click with a virtual pointer.
- **Risks:** none.
- **Effort S–M. Value medium-high:** this is what makes the critical-urgency fallback less necessary.

### F25. Monitor choice and floating-island style

- **What / who.** Who has it: DynamicNotch ("display selection", floating capsule on non-notch screens), MediaMate (per-display style), Atoll (minimal vs standard).
- **Mapping.** `Island.monitorIndex` returns `primaryIndex` and `_applyGeometry` uses `primaryMonitor`. Generalise both to a setting: 'primary', a connector name, or 'pointer' (follow `global.display.get_current_monitor()` on `notify::focus-window`). Floating style: offset `y` by 6 px and draw full rounded corners in `NotchShape` (top radius = bottom radius).
- **Implementation:**
  1. Schema `monitor` (s) and `style` (choices 'notch' | 'island').
  2. `_applyGeometry` / `_notchHeight` use the chosen monitor.
  3. The OSD hook compares `monitorIndex`, so it updates automatically.
  4. **Test.** `BN_MONITOR` already supports sizes; add a second `--virtual-monitor` to `start-headless.sh`.
- **Risks:** on multi-monitor setups the panel exists only on the primary monitor, so the notch would float on secondaries.
- **Effort M. Value medium:** multi-monitor users.

### F26. Hover glow / cosmetic effects

- **What / who.** Notchmeister (Glow, Cylon, Plasma, Radar).
- **Mapping.** A `Clutter.ShaderEffect` or a `St.DrawingArea` behind the shape, animated only while hovered.
- **Effort S. Value low:** fun, but it costs frames while hovered. Optional and off by default.

### F27. Lock-screen widgets (media, charging, timer)

- **What / who.** Who has it: Atoll, Alcove, DynamicNotch.
- **Mapping.**
  - **Mode support.** It requires `"session-modes": ["user", "unlock-dialog"]` in `metadata.json`, and the extension must handle `unlock-dialog` by hiding everything but safe widgets.
  - **What GNOME shows already.** The lock screen shows MPRIS media (via `ui/mpris.js` in the notification list) and a battery icon.
  - **Review.** EGO review is strict about unlock-dialog extensions (no keyboard grabs, no notification content).
- **Effort M–L. Value low-medium:** GNOME already shows most of it, and the review risk is high. **Not recommended now.**

### F28. Webcam "Mirror" preview

- **What / who.** NotchNook.
- **Mapping.** It would need a GStreamer `pipewiresrc` through the Camera portal inside the shell process, or a helper app. Heavy, with privacy questions (it lights the camera LED, which is intended).
- **Effort L. Value low. Not recommended.**

### F29. Color picker

- **What / who.** Atoll.
- **Mapping (verified).** `PickPixel` is exported from `ui/screenshot.js:3022`, and the shell's D-Bus `PickColorAsync` builds it as `new PickPixel(screenshot)` with a `Shell.Screenshot`, then `await pickAsync()` gives `{red, green, blue}` (`:2763-2779`). An extension can do the same in-process: no D-Bus sender check applies inside the shell.
- **Implementation.** A button in the open notch header, or a shortcut. It closes the notch, runs `PickPixel`, copies the `#rrggbb` hex to the clipboard (`St.Clipboard.set_text`) and peeks a swatch. Schema `color-picker` (b).
- **Risks:** it uses an exported-but-internal class.
- **Effort S. Value low-medium:** designers and developers.

### Not feasible / skipped

- **Navigation, sports, deliveries, flights:** no desktop source. Covered generically by F21.
- **Face ID / Apple Pay:** no equivalent. fprintd verify happens in GDM / the unlock dialog, outside a user extension's normal mode.
- **AirDrop:** the nearest is GSConnect's "share file". It could be a shelf (F20) action once both exist.
- **Silent switch:** already covered by the mute OSD through the existing HUD hook.
- **Download percentage from `.part` files:** impossible without a total size; use F21 LauncherEntry instead.
- **TopNotch's "hide the notch":** not applicable.

---

## 4. Prioritised roadmap

Value: how much a typical user notices (H/M/L). Effort: S < 1 day, M 1–3 days, L a week or more. "Idle cost" is the expected change to the measured 0.6% idle CPU.

| # | Feature | Value | Effort | Idle cost | Private-API risk | Phase |
|---|---|---|---|---|---|---|
| G1 | Peek queue with priorities (prerequisite) | (enabler) | S | 0 | none | 1 |
| F15 | Scroll/swipe/middle-click gestures | H | S | 0 | none | 1 |
| F5 | DND indicator + peek + Today-tab DND switch | M-H | S | 0 | none | 1 |
| F4 | Low / critical / full battery peeks | M-H | S | 0 | none | 1 |
| F1 | Privacy dots (mic / camera / screen share) | H | S-M | 0 | low (screenSharing fallback) | 1 |
| F7 | Screenshot thumbnail peek | H | S-M | 0 | low (icon match) | 1 |
| F10 | Caps Lock / layout peeks | M | S | ~0 | none | 1 |
| F2 | Bluetooth connect + battery peek | H | S-M | 0 | none | 2 |
| F3 | Audio output switch peek | M | S | 0 | none | 2 |
| F8 | Next-meeting countdown | H | M | 0 (one scheduled timeout) | low (`Calendar.DBusEventSource`) | 2 |
| F21 | Live-activity D-Bus API + LauncherEntry progress | H | M | 0 | none | 2 |
| F24 | Notification action buttons | M-H | S-M | 0 | low | 2 |
| F6 | Screen-recording live activity | M | S | 0 (1 s tick only while recording) | none | 2 |
| F13 | Weather (Today tab, optional clock) | M-H | S-M | 0 | medium (`dateMenu._weatherItem`) | 2 |
| F14 | Pomodoro, stopwatch, Wellbeing break | M | S | 0 | low (`Main.breakManager`) | 3 |
| F16 | Album-art accent tint | M | S | 0 | none | 3 |
| F11 | Workspace indicator in notch | M | S | 0 | medium (prototype override) | 3 |
| F9 | Wi-Fi / VPN / No-Internet peeks | M | M | ~0 | none | 3 |
| F22 | USB/drive mount peek | M | S | 0 | none | 3 |
| F23 | Quick toggles row | M | S-M | 0 | none | 3 |
| F18 | Clipboard history tab | M-H | M | ~0 | none (privacy-sensitive) | 3 |
| F12 | GSConnect phone battery / calls | M (niche) | M | 0 | medium (3rd-party API) | 4 |
| F17 | Synced lyrics (opt-in, network) | M | M | 0 closed / tick if shown | none (privacy) | 4 |
| F19 | System monitor tab | M | M | 0 (samples only while open) | none | 4 |
| F25 | Monitor choice + floating style | M (multi-monitor) | M | 0 | none | 4 |
| F29 | Color picker | L-M | S | 0 | low | 4 |
| F20 | File shelf (GTK helper) | H for some | L | 0 | high (window juggling, subprocess) | 5 |
| F26 | Hover cosmetic effects | L | S | frames while hovered | none | later |
| F27 | Lock-screen widgets | L-M | M-L | 0 | high (review) | skip |
| F28 | Webcam mirror | L | L | high while on | high | skip |

## 5. Recommended top 10

Ordered by value ÷ effort, keeping the near-zero idle cost.

1. **G1 + F15: peek queue and gestures.** The queue keeps the notch readable once more peeks exist, and scroll-for-volume / swipe-to-skip is the cheapest high-use feature.
2. **F1: privacy dots** (mic/camera/screen-share, with the app name in a peek). It is the most iPhone-like feature and doubles as a "call in progress" indicator. It reuses the mixer logic already in `extension.js`.
3. **F7: screenshot thumbnail peek.** The data already flows through the notification hook (`gicon` is the screenshot), so this is mostly a new view.
4. **F2 + F3: Bluetooth connect with battery, and audio output switch,** merged into one "audio route" peek through G1. This is the "AirPods connected" moment.
5. **F8: next-meeting countdown.** One scheduled timeout and its own `DBusEventSource`. Very noticeable for anyone with a calendar.
6. **F5 + F4: DND indicator and switch, and low/full battery peeks.** Both are tiny, and the Today tab gains GNOME's missing DND switch.
7. **F21: live-activity D-Bus API plus Unity LauncherEntry.** It turns any script or app into a live activity and gives real download/copy progress percentages. Fully testable in the headless session with `gdbus emit`.
8. **F24: notification action buttons** (hover pauses the timeout).
9. **F13: weather** through GNOME's own `WeatherClient` instance, on the Today tab (opt-in in the closed notch).
10. **F10 + F6: Caps Lock / layout peeks and the screen-recording live activity.** Small polish items that round out the "system HUD" story.

Next in line: F18 clipboard history (opt-in for privacy) and F14 Pomodoro. Then F20 file shelf, the defining feature of NotchNook and NotchDrop, which needs a GTK helper window on Wayland and should be its own project.

## 6. Cross-cutting checklist for every feature

- **Signal-driven only.** Any timer must exist only while its view is visible or its activity is active. Re-measure idle CPU in the headless shell, feature on versus off.
- **Cleanup.**
  - every `connectObject` gets a matching `disconnectObject` (or is tied to the island's destroy)
  - every `GLib.timeout_add` goes through `Island._setTimeout` or is removed in `destroy()`
  - every injection goes through `this._injections`
  - keybindings are removed with `Main.wm.removeKeybinding`
  - D-Bus names are unowned and signal subscriptions unsubscribed
  - Run the enable→disable→enable cycle in the headless shell and grep `shell.log` for `JS ERROR` / `CRITICAL`.
- **No sync IO in the shell process.** NexNotch's EGO review was flagged for it.
- **Private internals used, with fallbacks if missing:**
  - `Main.panel.statusArea.dateMenu._weatherItem._weatherClient`
  - `Main.panel.statusArea.screenSharing`
  - `WorkspaceSwitcherPopup.prototype.display`
  - the screenshot source icon match
  - Guard each with optional chaining and turn the feature off quietly, as the existing code does for `_volumeInput`.
- **Privacy defaults:** clipboard history, lyrics (network) and the GSConnect phone data start **off**. Peeks that show SSIDs or notification bodies are hidden while screen sharing (F1 detects it).
- **Prefs:** split the single "Live activities" group into **Live activities**, **Peeks**, **Tabs** and **Gestures** once more than about 10 switches exist.
