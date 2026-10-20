# Spec: Phase 3, cleanup and the boring.notch look

For the agent implementing this. Read the whole document before writing code.
Everything you need is here or in the repo. Read
`docs/specs/phase-2-system-awareness.md` first as well: its sections 2, 3 and 6
(rules, code map, how to test) still apply and are not repeated in full here.

## 1. Goal

Boring Notch is a GNOME Shell 50 extension (GJS, ES modules, Wayland) that puts a
"Dynamic Island" in the top bar. Phases 0 to 2 are done and merged. This phase has
three parts, to be done **in this order**:

| Part | What | Size |
|---|---|---|
| A | Clean up the open findings from the phase 2 review | small |
| B | Two features that phase 2 left out: a screen-recording live activity and an audio-output peek | small |
| C | The look of the original app: colours from the album art, art glow, scrolling titles, accent colour, a row-style volume peek, a draggable volume bar | medium |

Not in this spec (do not build): drop shadow, app-icon badge on the cover,
lyrics, the file shelf, weather, meeting countdown.

## 2. Ground rules

All rules of the phase 2 spec section 2 apply (branch and no pushing, zero idle
cost, clean disable, no synchronous I/O, guard private GNOME internals, verify
APIs against GNOME's real source, match the surrounding code style, CSS in
`src/style.css`, no personal data, don't touch `docs/plans/` and `LICENSE`).
Branch: **`phase-3-cleanup-and-look`**, made from the current `main`. Do not push
and do not merge.

### 2.1 Lessons from the phase 2 review

The phase 2 work was reviewed strictly and had four real defects. Each has a rule
now. Following these is part of being done.

1. **Every commit must load.** Seven commits in a row did not, because one doc
   comment had been damaged. Run `tools/headless/smoke.sh` (section 6.1) before
   **every** commit. It must print `all checks passed`. If it does not, do not
   commit. It was written to fail on exactly the phase 2 bugs, and does.
2. **Read your own diff.** Before each commit run `git diff` and read every
   *removed* line, not only the added ones. A one-line edit that removed half a
   comment broke the whole branch.
3. **Never assume a GObject property exists.** `gicon.icon_name` does not exist on
   `Gio.ThemedIcon` (it has `names`); the code threw on every notification with a
   themed icon and froze all later ones. Check the real property or method names
   in GNOME's source under `/home/aries/opensource/ref/shell-src/org/gnome/shell/`,
   or in the running shell with `GObject.Object.list_properties.call(Type)`.
4. **Test notifications the way apps send them:** `notify-send -i dialog-information`
   (set `DBUS_SESSION_BUS_ADDRESS=$(cat /tmp/bn-test-$USER/bus)` first), not only
   `Main.notify`, which sends no themed icon.
5. **Detect leaked listeners by counting calls, not queue lengths.** Peeks with the
   same `key` replace each other, so a doubled listener still shows a queue of 1.
   `smoke.sh` does this; copy its method for your own sources.
6. **Virtual input and signals are asynchronous.** After a virtual key press or
   pointer event, wait for the main loop (`timeout 1 tail -f /dev/null`) before
   reading state.
7. **Say only what the code does,** in commit messages and in the report. Two phase
   2 commit messages described the code inaccurately.
8. **A guard you remove may have been there for a reason.** Sizing the clock before
   the notch was on the stage produced 2000 log errors; the `get_stage()` check
   fixed it. Run the log check after layout changes.

## 3. What changed since the phase 2 spec

Code map additions (read these files before starting):

- `src/privacy.js`, `src/bluetooth.js`, `src/keyboard.js`: data sources following the
  `EventEmitter` + `destroy()` pattern.
- `src/island.js`: the peek queue (`_showPeek`, `Priority`), `_place()` which sizes
  and centres a closed view, `_clockSlot` (the clock sits in a slot as wide as the
  notch, centred by the layout), `ClosedView.extraHeight()` for peeks taller than the
  top bar, and the new settings keys read at the moment of use.
- `src/zoom.js`: `value` (size × text scaling), `layoutValue` (notch geometry), and
  `textValue` (font sizes); `src/style.js` applies them to `src/style.css`.
- `prefs.js`: four pages (General, Music, Peeks, About) built by one function each.
- `tools/headless/`: the test tools, now with `smoke.sh`.

Two conventions to keep:

- **Colours may be set from JS** (`actor.style = 'color: rgb(…)'`), pixel sizes may
  not: pixel values in JS strings are not zoomed. Sizes go in `src/style.css`.
- Closed views are children of `Island._closedLayer`, placed by `_place()`, and listed
  where `Island._init` creates them.

## 4. Part A: cleanup

One commit per item (or per two closely related items). Each item names its
acceptance check.

**A1. `src/bluetooth.js`: delete the unreachable branch.** `_onChange`'s timeout
callback checks `this._devices.get(path) !== entry` and calls `this._forget(entry)`,
which does not exist. `_unwatch` already removes the pending source, so the branch
can never run. Delete it.
*Check:* `grep -n _forget src` finds nothing; `smoke.sh` passes.

**A2. Bluetooth disconnect peek.** For a device that reports a battery, a disconnect
shows only "80%". Make the body say "Disconnected" whatever the battery.
*Check:* `global.bn._bluetooth.emit('disconnected', {alias:'X', icon, battery: 80})`
gives a peek whose body is "Disconnected".

**A3. `src/privacy.js`: snapshot at start.**
(a) The camera state starts as `false` although the commit message said recording
already running lights the dot: read `cameras_in_use` when the monitor is created.
(b) At login the mixer may not be ready when the extension enables, so streams it
discovers later would arrive as new and pop a `'started'` peek for recording that was
already running. Import `Gvc` (`import Gvc from 'gi://Gvc'`), and while
`control.get_state() !== Gvc.MixerControlState.READY` update the app set and emit
`'changed'` but not `'started'`; once the state becomes READY (signal `state-changed`),
take a fresh snapshot and start reporting. Disconnect that signal in `destroy()`.
*Check:* with `control.get_state` stubbed to return `Gvc.MixerControlState.CONNECTING`,
adding an app emits `'changed'` and no `'started'`; after stubbing READY and emitting
`state-changed`, a newly added app emits `'started'`. The mic logic is tested the way
the review did: stub `control.get_source_outputs` to return fake outputs
(`{get_application_id: () => id, get_name: () => name}`) and emit `stream-added`.

**A4. README.** Remove the "System peeks" bullet; it repeats the Do Not Disturb,
Screenshots, Bluetooth and Keyboard bullets just above it. (There will be new bullets
for this phase's features; add one line per feature, no repeats.)

**A5. `src/style.css`:** the comment "Do Not Disturb: moon and peek switch colour with
its state" is wrong, they are always orange. Fix the comment.

**A6. `extension.js`: import order.** Imports are alphabetical by module path:
art, audio, battery, bluetooth, downloads, island, keyboard, media, privacy, style,
timer, zoom (and the new ones you add, in place).

**A7. Inconsistent guards.** `island.js` reads `privacy?.state ?? {…}` and then calls
`privacy.connectObject` unguarded; `privacy.js` `destroy()` does `this._handles ?? []`;
`_batteryNoticeUntil ?? 0` is read but never initialised. All of these are always
present: remove the guards, and initialise `_batteryNoticeUntil = 0` in the constructor.

**A8. `BatterySneakView.update`:** it never removes `bn-charging` in the low, critical
and full branches (the label ended with `bn-charging bn-low`). Remove all three state
classes first, then add the right one.
*Check:* after a "plugged in" peek and then a low-battery peek, the label's
`style_class` has `bn-low` and not `bn-charging`.

**A9. Screenshot peek: release the texture after the fade.** `_endSneak` clears the
screenshot's content immediately, so the picture vanishes while the closed view is
still fading out and the notch is still tall. Release it when the fade-out has
finished instead: give `ClosedView` an `onHidden()` hook (default does nothing) that
`Island._fade` calls when a hide has completed (`isFinished` true), and have
`ScreenshotPeekView.onHidden()` clear its content. Remove `_releaseScreenshot` and its
calls. A peek that replaces another of the same view must not clear anything.
*Check:* shortly (about 100 ms) after the peek ends the content is still set; after
about 500 ms it is `null`.

**A10. Screenshot peek layout.** The thumbnail sits at the far left and the lone
"Screenshot" caption at the far right with a wide gap. Put the thumbnail and caption
next to each other, centred as a group, and reduce `sideWidth()` so the notch is only
a little wider than its content.
*Check:* screenshot at 100% and 125%, text size 1.25 and 1.6: nothing clipped, group
centred.

**A11. Privacy peek text.** At the default text size the text reads "Firefox is using
the micropho…". Raise the limit (`.bn-privacy-peek .bn-icon-text-title`, and
`sideWidth` if the notch is too narrow) so that "Firefox is using the microphone" shows
in full at text size 1.25, and an unusually long app name is cut with an ellipsis, not
mid-notch overflow.
*Check:* screenshots with both a short and a 40-character app name.

## 5. Part B: two features left from phase 2

### B1. Screen-recording live activity

A red dot and the elapsed time in the closed notch while GNOME's screen recorder runs;
a click stops it.

API (verified in GNOME 50): `Main.screenshotUI` (from `ui/main.js`) has the GObject
property `screencast-in-progress` (read it as `screencast_in_progress`), the signal
`notify::screencast-in-progress`, and the method `stopScreencast()`, which is `async`
(returns a promise; call it without awaiting and log a rejection).
`ui/status/remoteAccess.js` lines 91 to 109 use exactly these from outside the class.

Build `src/recording.js`: `RecordingMonitor extends EventEmitter` with a `recording`
boolean (initialised from the property), `'changed'` emitted on every change, and
`stop()`. In `Island`: an `IconTextView('bn-record-live', 52)` with icon
`media-record-symbolic` (red, in CSS) and the elapsed time as `m:ss`. It is a live
activity: put it **first** in `_currentClosedView()`, above the timer. Tick the elapsed
time once a second **only while recording and the notch is closed**, with a
`GLib.timeout_add_seconds` you remove when recording stops, the notch opens, or the
island is destroyed. Clicking the closed notch while it shows stops the recording
instead of opening the notch (see `_onButtonPress`).
Setting `show-recording` (default true).

*Check (real recording cannot run headless, so stub the monitor):* define
`Object.defineProperty(Main.screenshotUI, 'screencast_in_progress', {get: () => true,
configurable: true})` and `Main.screenshotUI.notify('screencast-in-progress')`; the
activity shows, counts up once a second, stops ticking when the property returns to
false (verify by checking the timeout is gone), and a click calls `stopScreencast`
(stub it). Disable → enable leaves no extra timer or listener. Screenshots at both
scales.

### B2. Audio-output peek

"Headphones" or "Speakers" appears when the sound output changes.

API: `getMixerControl()` from `ui/status/volume.js`; the signal `active-output-update`
(argument: the device id; see how `OutputStreamSlider` handles it, `volume.js` around
line 302); `control.lookup_output_id(id)` returns a `Gvc.MixerUIDevice` with the
properties **`description`** and **`icon-name`** (checked with
`GObject.Object.list_properties`).

Build `src/audioRoute.js`: `AudioRouteMonitor extends EventEmitter`. Ignore updates
until the mixer state is READY and ignore an update that repeats the device that was
already active, so enabling the extension or resuming from suspend does not peek.
Emit `'changed'` with `{name, iconName}`. Island: `IconTextView` peek, icon from
`iconName`, title `name`, `key: 'audio-route'`, timeout 2500, `Priority.STATUS`.
Setting `show-audio-route` (default true). Do not try to merge it with the Bluetooth
peek; both appearing in turn is fine.

*Check:* stub `control.lookup_output_id` to return `{description: 'Headphones',
icon_name: 'audio-headphones-symbolic'}` and `control.emit('active-output-update', 7)`:
one peek. Emitting the same id again: none. A different id: one. Before the mixer is
ready: none.

## 6. Part C: the look

Each item has its own setting, so the user can turn it off. Measure CPU where stated.

### C1. Colours from the album art

The bars, the artist and time labels, and the seek bar take their colour from the
cover.

Build `src/artColor.js`: `averageColor(uri, cancellable)` returns a promise of
`[r, g, b]` (0 to 255). Decode asynchronously: `Gio.File.new_for_uri(uri).read_async`
then `GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 16, 16, true,
cancellable, callback)` and `_finish` (both exist, checked). Average the opaque pixels
(`get_pixels()`, `n_channels`, `rowstride`), then lift the brightness to at least 0.6
in HSV so a dark cover stays visible. Cache results in a `Map` by URI, at most 50
entries, oldest out. **Never decode synchronously** (no `new_from_file_at_scale`).
Cancel the pending decode when the track changes and in `destroy()`.

Apply: `Visualizer.setColor(rgb | null)` sets each bar's inline `background-color`
(null clears the style); `MediaPlayer` tints the artist and time labels and the
slider's active fill (`-barlevel-active-background-color: rgb(…)`); null resets.
`Island._syncArt` computes the colour after the art URI resolves and ignores an answer
for a track that is no longer showing (as `_syncArt` already does for the URI).
Setting `art-colors` (default true); off means null everywhere. No art means null.

*Check:* generate solid red, green and black PNGs with Pillow in `/tmp`, run
`./player.sh /tmp/red.png`, and assert the computed colour is red-ish, that black
yields a visible (lifted) colour, and that a screenshot shows tinted bars. Changing the
track mid-decode does not apply the old colour.

### C2. Art glow and paused state

A blurred, enlarged copy of the cover glows behind it while playing; paused, the cover
shrinks and dims.

`Shell.BlurEffect` has the properties `radius`, `brightness` and `mode`
(`Shell.BlurMode.ACTOR` or `BACKGROUND`), checked in the running shell. Put a second
`St.Widget` with the same `background-image` behind the cover inside a
`Clutter.BinLayout` wrapper, scaled about 1.3 × 1.4 with the cover's pivot at the
centre, opacity about 128, and `add_effect(new Shell.BlurEffect({radius: 40, mode:
Shell.BlurMode.ACTOR}))`. Show it only while playing. When paused, ease the cover's
scale to 0.85 and its opacity to about 60% over 200 ms; this animates only on a state
change, never continuously. Use it only for the big cover in the Home tab.
Setting `art-glow` (default true; it governs the glow, the paused dimming always
applies).

**Cost rule:** measure the shell's CPU with the notch **open on Home with music
playing**, before and after (README says about 1.0%). It must not rise by more than
0.5 percentage points. If the blur costs more, drop the blur and keep a plain scaled,
dimmed copy, and say so in the report.

*Check:* screenshots playing and paused; the glow does not extend beyond the notch
(the notch clips); a track change updates the glow's image.

### C3. Scrolling long titles

When a title or artist is wider than its space, it scrolls instead of being cut off.

Build `MarqueeLabel` in `src/widgets.js`: an `St.Widget` with
`clip_to_allocation: true` holding an `St.Label`. When the label's natural width exceeds
the allocation **and** scrolling is active, wait 1 s, ease `translation_x` to
`-(overflow + gap)` over `overflow / 30` seconds, pause, jump back, and stop after two
passes per track (the README measured that continuous easing costs about 10% of a CPU
core elsewhere, so it must not run forever). Scrolling is active only while the notch
is open (`OpenView.startTicking`/`stopTicking`), so nothing animates while closed or
parked. Call `remove_all_transitions()` on destroy. Use it for the title and artist in
`MediaPlayer` and in `MusicPeekView` (there it may scroll while the peek shows).
Setting `scroll-titles` (default true); off falls back to ellipsis.

*Check:* a 60-character title on the fake player scrolls twice and stops; a short one
never moves; closing the notch stops it; frame times during a scroll stay near 16.7 ms.

### C4. Accent colour

An optional colour for the checked states and the bars.

Setting `accent-mode`: `off` (the current look: white bars, orange timer chip; default),
`system` (GNOME's accent colour) or `custom` with `custom-accent` (a `#rrggbb` string,
default `#3584e4`). It colours: `.bn-chip:checked`, `.bn-toggle:checked`, the seek bar
fill and the volume bar fill.

Implementation: `src/style.css` is already a template processed by `src/style.js`. Use
a token such as `@accent` where the accent applies (with the `off` colour as the
fallback in the loader), and have the loader substitute it: `-st-accent-color` for
`system`, the hex for `custom`, the old colour for `off`. Reload the stylesheet when
`accent-mode`, `custom-accent` or the system accent changes
(`St.Settings.get()` signal `notify::accent-color`). `-st-accent-color` works as a
colour in St CSS (the calendar's "today" circle uses it); **verify it also works for
`-barlevel-active-background-color`** and say what you found; if it does not, set the
bars' colour from JS instead.
Prefs: a dropdown for the mode, and a `Gtk.ColorDialogButton` shown only for `custom`,
converting to `#rrggbb`.

*Check:* switch through the three modes at runtime: the chips and bars change at once
without reloading the extension; the system accent follows
`gsettings set org.gnome.desktop.interface accent-color 'red'`.

### C5. Row-style volume and brightness peek

Instead of the inline peek, the closed notch grows down by one row showing the icon,
a longer bar, and the percentage; the clock stays visible above it.

Setting `hud-style`: `inline` (current; default) or `row`; and `hud-percentage` (default
true) for the number in both styles. Build `RowHudView` (a `ClosedView` with
`extraHeight()` of about 28 design pixels and `showsClock` true), chosen by
`Island.showHud` from the setting. The existing height spring already animates the
growth.

*Check:* screenshots of both styles at both scales; switching the setting changes the
next peek; repeated volume presses update one peek (`key: 'hud'`).

### C6. Draggable volume and brightness bar (optional, last)

Dragging the bar in the peek sets the level. This one is fiddly (see the risks); if it
cannot be made robust, **do not ship it**, and say why in the report.

Replace the `BarLevel` in the HUD view with `Slider.Slider` (`ui/slider.js`, already
imported in `openView.js`; signals `drag-begin`, `drag-end`, `notify::value`) when the
peek has a level. Work out what the peek is for from the icon name (`audio-volume*` is
volume, `display-brightness*` is screen brightness); keyboard backlight and microphone
stay read-only. Volume: `getMixerControl().get_default_sink()`, set `volume` and call
`push_volume()` (see `Island._changeVolume`). Brightness: `Main.brightnessManager.globalScale`
(`misc/brightnessManager.js`), whose `value` is read/write; **it is `null` or has no value
on machines without a backlight**, so guard it and leave the bar read-only there.
Keep the peek on screen while the pointer is on the bar or a drag is going (re-arm the
timeout), and opening the notch by clicking the peek must not trigger from a click on
the slider.

Risks: setting the volume makes GNOME post another OSD, which calls `showHud` again and
could recurse; guard with a flag so your own change does not re-enter. Never write the
level back to the slider from the OSD while dragging.

*Check:* with the test audio session (`audio.sh`) a drag changes the sink's volume
(read it back) and the peek stays up; no recursion (the log has no repeated entries);
releasing lets the peek time out.

## 7. Settings keys to add

| Key | Type, default | Page |
|---|---|---|
| `show-recording` | b, true | Peeks |
| `show-audio-route` | b, true | Peeks |
| `art-colors` | b, true | Music |
| `art-glow` | b, true | Music |
| `scroll-titles` | b, true | Music |
| `accent-mode` | s (off, system, custom), `off` | General |
| `custom-accent` | s, `#3584e4` | General |
| `hud-style` | s (inline, row), `inline` | Peeks |
| `hud-percentage` | b, true | Peeks |

Every key gets a schema entry with a summary, a row in `prefs.js` with a one-sentence
subtitle, and one line in the README features list (no repeats). Recompile with
`glib-compile-schemas schemas/`.

## 8. How to test

Use `tools/headless/` as described in section 6 of the phase 2 spec (start with
`session.sh --fractional 2560x1440 &`, `wait.sh --scale 1.25`, drive with `eval.sh`,
`shot.sh`, `frames.sh`; stop with `stop.sh`). Also test at 100% scale (drop
`--fractional` and the scale argument). Additions:

### 8.1 The smoke check

```sh
cd /home/aries/opensource/boring-notch-linux/tools/headless
./smoke.sh        # after wait.sh; must print "all checks passed"
```

It checks that the extension loads, that notifications with and without a themed icon
still show and do not wedge the tray, that disable → enable leaves one notch and one
handler per event, and that the shell log has no `JS ERROR` or `CRITICAL` lines. Run it
**before every commit** and again at the end. If you add a feature whose bug would not
be caught by it, extend it (a new check in the same style) as part of that feature.

### 8.2 Test art

Make solid-colour covers with Pillow and run the fake player with one:
```sh
python3 -c "from PIL import Image; Image.new('RGB', (200, 200), (220, 40, 40)).save('/tmp/red.png')"
./player.sh /tmp/red.png
```

### 8.3 Idle and open CPU

Same method as the phase 2 spec 6.4. Report the **open, playing** number for C2 and the
**closed, nothing playing** number at the end; closed idle must stay near 0.3 to 0.6%.

## 9. Definition of done

- [ ] Part A: all eleven items done, each with its check shown in the report.
- [ ] Part B: both features work, toggleable, default on.
- [ ] Part C: C1 to C5 work, toggleable where specified; C6 shipped **or** its omission
      explained.
- [ ] `./smoke.sh` printed `all checks passed` before every commit and at the end
      (say how you verified the "before every commit" part: the commit-by-commit run is
      easy to forget, so list the commits and tick them).
- [ ] Tested at 100% and 125% scale, with screenshots of each new peek and view under
      `docs/specs/phase-3-evidence/`.
- [ ] Idle and open CPU reported.
- [ ] Schema compiles; every key has a prefs row and a README line.
- [ ] `docs/specs/phase-3-report.md` written (section 10).
- [ ] Working tree clean, nothing pushed, branch `phase-3-cleanup-and-look`.

## 10. Report to hand back

`docs/specs/phase-3-report.md` with: what was built per item (three lines each); for
every acceptance check the command you ran and its output; every private GNOME
internal used and its fallback; CPU numbers; anything you could not test and why; what
you changed from this spec and why. Be honest about gaps: each claim will be checked.

## 11. How it will be reviewed

As in phase 2: a strict review of every changed line, the whole test plan run again by
the reviewer at both scales, an independent CPU measurement, the disable → enable
cycle, a search for every `connect`, timeout, subprocess and proxy and its teardown,
`git diff main --stat` for files that should not have changed, a check that **every
commit loads** (the reviewer will run `smoke.sh` on each one), and a read for
unnecessary or inconsistent code. Findings are reported as must-fix and should-fix.
