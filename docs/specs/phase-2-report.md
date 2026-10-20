# Phase 2 report: system awareness

Status: implemented by the delegated agent (7 commits), reviewed strictly, and
the five must-fix findings of the review fixed (4 more commits). The
should-fix list is still open; see the end. Nothing is pushed.

Review details: `phase-2-review.md` (in the parent folder of the repo, next to it;
not part of the repository).

## What was built

| Feature | Files | Setting |
|---|---|---|
| F1 Privacy dots and peek | `src/privacy.js`, `island.js`, `style.css` | `show-privacy-indicators` |
| F2 Screenshot peek | `closedViews.js` (`ScreenshotPeekView`), `island.js` | `screenshot-peek` |
| F3 Bluetooth peek | `src/bluetooth.js`, `island.js` | `show-bluetooth` |
| F4 Do Not Disturb | `island.js`, `openView.js` (header toggle) | `show-dnd` |
| F5 Battery warnings | `battery.js`, `closedViews.js`, `island.js` | `show-battery-warnings` |
| F6 Keyboard peeks | `src/keyboard.js`, `island.js` | `show-keyboard` |

Groundwork: `ClosedView` exported with `extraHeight()`, and the list of
recording apps to ignore shared as `IGNORED_RECORDING_APPS` in `src/audio.js`.

## What the review found, and what was fixed

| # | Finding | Fixed in |
|---|---|---|
| M1 | The branch did not load: a doc comment in `closedViews.js` had become a bare `/**`, swallowing `LiveMediaView`. Every commit was affected. | `115a585` |
| M2 | `gicon.icon_name.startsWith(...)` threw for every themed-icon notification, which also wedged the tray so later notifications never appeared. | `f342606` |
| M3 | The microphone peek fired again whenever a second app joined or left. | `fcbc3fc` |
| M4 | Apps that send no desktop id gave no dot and no peek. | `e9fba8c` |
| M5 | Report and evidence missing, tree not clean. | this commit |

## Evidence

Everything ran in the headless shell (`tools/headless`), at 125% display scale
with 1.25 text scaling unless stated. Screenshots are in
`docs/specs/phase-2-evidence/`: `privacy-peek-125`, `screenshot-peek-125`,
`bluetooth-peek-125`, `dnd-peek-125`, `battery-low-125`, `caps-lock-125`,
`indicators-125`, `indicators-100` (all dots and the moon beside the clock, at both
scales) and `header-dnd-125`, `header-dnd-100` (the DND toggle in the header).

Per acceptance bullet, with the result:

- **Extension loads:** `wait.sh` prints `state=1`; no `JS ERROR` or `CRITICAL` in
  the log across the whole run.
- **Themed-icon notifications (M2):** `notify-send -i dialog-information` shows a
  peek and leaves the tray queue at 0; a plain notification afterwards also shows.
  GNOME's own battery notice sent right after our warning is swallowed
  (`notify-send -i battery-caution-symbolic`); the same notice 8 s later is shown;
  the swallowed notice stays in the tray's list.
- **Microphone logic (M3, M4):** driving the monitor with stream lists shaped like
  real ones:
  - an app with a null id named "Firefox": dot on, one `started`
  - app One starts: one `started`; app Two joins: none; app Two leaves: none; One
    stops: dot off; app Two starts later: a new `started`
  - the visualizer and the sound-settings meter together: no dot, no peek
- **Screenshot peek:** a notification built like GNOME's own (an `St.ImageContent`
  as `gicon`) grows the notch from 40 to 130 px and shows the image; the texture is
  released afterwards; a recording notification (no image) stays an ordinary peek;
  the setting off gives ordinary peeks.
- **Bluetooth:** peek with name and battery; three quick events give one peek.
- **Do Not Disturb:** moon and peek appear when `show-banners` goes false; a
  notification sent under DND shows no peek; a real pointer click on the header
  toggle flips the key both ways; changing the key elsewhere updates the toggle.
- **Battery:** warning levels 3 and 4 and `full` show "Low battery", "Critical
  battery" and "Fully charged"; the red colour of the low peek is in the
  screenshot, the green of "full" was not looked at.
- **Keyboard:** Caps Lock through a virtual keyboard gives "Caps Lock on" and
  "Caps Lock off"; Shift gives nothing; switching to a second layout gives its
  short name and display name.
- **Settings:** with each of the six settings off, its trigger queues no peek (and
  the dots and the moon hide).
- **Disable and re-enable:** state active, one notch on screen, and exactly one
  call into the island per event for every source (keyboard, bluetooth, battery,
  privacy), so no listener leaked.
- **Idle CPU**, closed notch, nothing playing, 60 s, one run each: `main` 0.28%,
  the branch 0.33%. Measured before the four fixes, which add no work at idle.

## Private GNOME internals used

- `getMixerControl` (from `ui/status/volume.js`) and `getInputSourceManager` (from
  `ui/status/keyboard.js`): exported by GNOME's JS but internal to the shell. The
  mixer is used with optional chaining; `getInputSourceManager()` is not guarded.
- `Main.panel.statusArea.quickSettings._volumeInput._input` (underscore members),
  already used before this phase for the microphone indicator, guarded with
  optional chaining.
- Public: `Shell.CameraMonitor`, `global.backend.get_remote_access_controller()`,
  `GnomeBluetooth`, the seat's keymap, UPower.

## Not tested

- A real camera, real screen sharing and real Bluetooth devices cannot be produced
  in the headless shell; their paths were driven by emitting the monitors' signals.
- The microphone path was driven with stream lists, not a real stream: GNOME's
  mixer did not list a test recorder capturing a silent test sink.
- What happens at login when the mixer becomes ready after the extension enables
  and finds recording that is already running.

## Still open (should-fix from the review)

1. `bluetooth.js`: the debounce callback calls `this._forget(entry)`, which does not
   exist, in a branch that cannot run. Delete the branch.
2. A Bluetooth disconnect of a device with a battery shows only "80%".
3. `privacy.js`: the camera state is not read when the monitor starts.
4. README: the "System peeks" bullet repeats the four above it.
5. `style.css`: a comment says the moon and DND peek change colour with state; they
   do not.
6. `extension.js`: the `PrivacyMonitor` import is out of alphabetical order.
7. Inconsistent defensive code (`privacy?.state`, `this._handles ?? []`,
   `_batteryNoticeUntil ?? 0` never initialised).
8. `BatterySneakView.update` leaves `bn-charging` on low and full peeks.
9. The screenshot texture is released before the closed view finishes fading out.
10. Screenshot peek layout: a wide gap between the thumbnail and its caption.
11. Two commit messages (Bluetooth, battery) describe the code inaccurately.
12. New, found while collecting evidence: the privacy peek text is cut off at the
    default text size ("Firefox is using the micropho…"); raise
    `.bn-privacy-peek .bn-icon-text-title` `max-width`.
