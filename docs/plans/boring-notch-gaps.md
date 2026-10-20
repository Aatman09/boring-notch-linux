# boring.notch features missing from Boring Notch for GNOME, and how to build them

Date: 2026-10-20
Scope: every user-facing feature and setting in `ref/boring.notch` (Swift) compared against `boring-notch-linux` (GNOME Shell 50, GJS). The plan covers the gaps only. Features the port already has (clock, Today tab, notification peeks, MPRIS player with visualizer, inline volume/brightness HUD, battery plug peek, Timer tab, download peeks, size and clock settings) are not proposed again.

How it was checked:
- Read every Defaults key in `boringNotch/models/Constants.swift`, every section of `components/Settings/SettingsView.swift`, `ContentView.swift`, `BoringViewCoordinator.swift`, `models/BoringViewModel.swift`, `boringNotchApp.swift`, and the Notch, Music, Calendar, Live activities, Shelf, Webcam, Onboarding, observers, managers and Shortcuts folders.
- Read all of the port's source (`extension.js`, `src/*.js`, `prefs.js`, the schema).
- Every GNOME API named below was checked against the GNOME Shell 50 JS at `ref/shell-src/org/gnome/shell/` or the installed typelibs/GIRs (`/usr/lib/x86_64-linux-gnu/mutter-18/{Meta,Clutter}-18.gir`, `/usr/lib/gnome-shell/{St,Shell}-18.typelib`). Anything not confirmed is marked **(verify)**.

---

## 0. How new features fit this codebase

Each plan below uses these patterns. They come from the current code.

| Need | Where it goes today |
|---|---|
| Closed-notch content (live activity) | Subclass `ClosedView` in `src/closedViews.js` (`sideWidth()`, `showsClock`), add the instance to `Island._closedLayer` in `src/island.js`, give it a priority in `Island._currentClosedView()`. |
| Temporary peek | `Island._showSneak(view, timeoutMs, action)`. It is cleared by `_endSneak()` and on open. |
| Open tab | Add to `TABS` (`src/openView.js`), `OPEN_SIZES` (`src/island.js`) and `OpenView._pages`. Pages are parked at `PARKED_Y`, not destroyed. |
| Setting | Key in `schemas/…gschema.xml`, row in `prefs.js`, `settings.connectObject('changed::key', …)` in the consumer, then `_relayout()`. |
| Data source | An `EventEmitter` class in `src/` built in `extension.js enable()`, passed into `Island`, with `destroy()` called in `disable()`. Use `Gio.Cancellable` for async D-Bus. |
| Shell override | `this._injections.overrideMethod(...)` in `extension.js`. `InjectionManager.clear()` undoes it. |
| Subprocess | Follow `src/audio.js`: `Gio.Subprocess` with a STDOUT pipe, line or frame reads on the main loop, `force_exit()` on stop. Run it only while the output is on screen. |
| Dynamic colours | Inline `actor.style = 'color: …'` (the zoomed stylesheet in `src/style.js` only rewrites pixel lengths, and colours need no zoom). |

**Idle-cost rule (from the README):** nothing polls while idle. Every feature below says what runs while idle, and the target is "nothing" or "a D-Bus/file signal subscription".

**Test harness (applies to every item):**
- `dbus-run-session gnome-shell --headless --virtual-monitor 1920x1080 --wayland` (plus `--unsafe-mode` or `global.context.unsafe_mode = true` so `org.gnome.Shell.Eval` works).
- Drive the shell with `gdbus call --session --dest org.gnome.Shell --object-path /org/gnome/Shell --method org.gnome.Shell.Eval '<js>'`. The island can be reached through `Main.extensionManager.lookup(UUID).stateObj._island`.
- Screenshots: `org.gnome.Shell.Screenshot.ScreenshotArea`.
- Media: the existing fake MPRIS player. Extend it to expose `Volume`, `Seek` and `xesam:asText`.
- Battery and power profiles: `python3 -m dbusmock --template upower` and `--template power_profiles_daemon` on a private system bus (`DBUS_SYSTEM_BUS_ADDRESS`).
- Calendar: a small GJS mock that owns `org.gnome.Shell.CalendarServer` and emits `EventsAddedOrUpdated` with ids shaped like `sourceUid\nobjectUid` (the shape `ui/calendar.js` expects in `_onClientDisappeared`).
- Input: `Clutter.get_default_backend().get_default_seat().create_virtual_device(...)`, then `notify_scroll_continuous`, `notify_discrete_scroll` and `notify_touch_down` (all in Clutter-18.gir).
- CPU: `pidstat -p $(pgrep -f 'gnome-shell --headless') 1 30` for each state, compared against the README cost table.

Effort: **S** ≤ 1 day, **M** 2–4 days, **L** 1–2+ weeks. Value: how much a typical user would notice it (High / Medium / Low).

---

## 1. Media

### 1.1 Music sneak peek on track or playback change (two styles), plus a shortcut to show it

**boring.notch:** When a track starts or changes, the notch briefly shows what is playing. *Standard* style adds a second row under the notch with a music note and a scrolling "Title – Artist" (`ContentView.swift` lines 324–336). *Inline* style widens the music live activity to 380 pt, with the title on the left and the artist on the right in the album colour (`ContentView.swift` 404–449). The trigger is `MusicManager.updateSneakPeek()` (`managers/MusicManager.swift` 585–594), called on play and on content change. Settings: `enableSneakPeek` (default off), `sneakPeekStyles` (`standard`/`inline`) in the Media pane. Shortcut `toggleSneakPeek` (Cmd+Shift+H) in `Shortcuts/ShortcutConstants.swift` and `boringNotchApp.swift`.

**Linux fit:** Fits directly. MPRIS already emits `Metadata` and `PlaybackStatus` changes (`src/media.js`). No new technology.

**Implementation:**
1. `src/media.js`: give `MprisPlayer` a `trackKey` (`xesam:trackid` + title + artist). In `MediaManager`, emit a new `'track-changed'` signal when the active player's `trackKey` changes while it plays, or when it goes from paused to playing.
2. `src/closedViews.js`:
   - `MusicPeekView extends ClosedView` for **inline**: album art left, then title (left) and artist (right) on the two sides, `sideWidth()` about 150, `showsClock = false`.
   - For **standard**, add a `secondRow` mode: the closed height becomes `notchHeight + 22` and a one-line label sits under the panel row. In `Island._relayout()`, let the closed view return `extraHeight()` (default 0) and add it to `height`. The height spring already exists, so the notch grows down and back.
3. `src/island.js`: `media.connectObject('track-changed', () => this._onTrackChanged())`. If `enable-sneak-peek` is on and the notch is closed, call `_showSneak(this._musicPeek, SNEAK_MS /*3000*/, () => this.open('home'))`.
4. Schema: `enable-sneak-peek` (b, false), `sneak-peek-style` (s, choices `standard|inline`, default `standard`). Add prefs rows in a new **Media** page (see 9.3).
5. Shortcut: see 7.2 (`toggle-sneak-peek` key).

**Testing:** Use the fake MPRIS player to change `Metadata`. Assert `island._sneak === island._musicPeek` through Eval, take a screenshot of both styles, and check the peek clears after 3 s. Edge cases: no peek while open, and no peek when only `Position` changes.

**Risks:** Players that rewrite `Metadata` on every position update (some browser players) would peek repeatedly, so debounce on `trackKey`. Idle cost is zero (signal driven). Cleanup: the view is a child of the island and is destroyed with it, and the signal uses `connectObject`.

**Effort / value:** S. High (it is the most visible "Dynamic Island" behaviour).

### 1.2 Configurable control slots (3–5 slots: shuffle, previous, play/pause, next, repeat, volume, favourite, back 15 s, forward 15 s)

**boring.notch:** `models/MusicControlButton.swift` (cases and the default layout `[none, previous, playPause, next, none]`, 3–5 slots), `components/Settings/MusicSlotConfigurationView.swift` (a drag-to-reorder editor), `NotchHomeView.swift` `slotToolbar`/`slotView` (lines 213–278), `VolumeControlView` (328–417, an expanding per-app volume slider), `MusicManager.skip(seconds:)`, `setVolume`. Keys: `musicControlSlots`, `musicControlSlotLimit` (and the legacy `showShuffleAndRepeat`).

**Linux fit:** Mostly fits. MPRIS has `Seek(x Offset)` for ±15 s and a read/write `Volume` (d) property for per-player volume. There is no MPRIS "favourite/like" method, so leave Favourite out (or show it disabled, as boring.notch does when `canFavoriteTrack` is false).

**Implementation:**
1. `src/media.js`: add `<method name="Seek"><arg direction="in" type="x"/></method>` and `<property name="Volume" type="d" access="readwrite"/>` to `PlayerIface`. Add `skip(seconds)` (call `SeekAsync(seconds*1e6)` and update `_position`), `get volume()`, `setVolume(v)` (`this._player.Volume = v`), and `get canControl` checks. Some players do not implement `Volume`: catch the property error and hide the slot.
2. `src/openView.js` `MediaPlayer`: replace the fixed five buttons with `_buildControls(slots)`, which maps ids `shuffle|previous|play-pause|next|repeat|volume|back-15|forward-15|none` to buttons. `none` is an empty `St.Widget` of button width. For `volume`, a button that, when clicked, reveals a `Slider.Slider` about 48 px wide (reuse `ui/slider.js`, already imported). Rebuild on `changed::music-controls`.
3. Schema: `music-controls` (as, default `['shuffle','previous','play-pause','next','repeat']` so current users see no change; boring.notch's default hides shuffle and repeat). Validate length 3–5 in code.
4. Prefs: five `Adw.ComboRow`s ("Slot 1"…"Slot 5", plus a "Number of slots" `Adw.SpinRow` 3–5). This is simpler and more accessible than boring.notch's drag editor. A drag editor could come later with `Gtk.DragSource`/`Gtk.DropTarget` in prefs.

**Testing:** Extend the fake player with `Seek` and `Volume`. Through Eval, click each slot's `St.Button` (`button.emit('clicked', 1)`) and assert the D-Bus calls arrive.

**Risks:** None notable. No idle cost.

**Effort / value:** S–M. Medium.

### 1.3 Album-art colour: coloured visualizer, tinted player text, slider colour choice

**boring.notch:** `MusicManager.calculateAverageColor()` (575–583) using `NSImage.averageColor` (`extensions/NSImage+Extensions.swift`). It colours the closed spectrum (`ContentView.swift` 452–464, `coloredSpectrogram`), the artist name and the times (`playerColorTinting`, `NotchHomeView.swift` 150, 504), and the seek bar (`sliderColor`: white / album art / accent, `NotchHomeView.swift` 488–490). Settings live in the Appearance pane. `Color.ensureMinimumBrightness` keeps dark covers readable.

**Linux fit:** Fits. `src/art.js` already turns every art URL into a local file. GdkPixbuf can decode it scaled down asynchronously.

**Implementation:**
1. New `src/artColor.js`: `averageColor(uri, cancellable) → Promise<[r,g,b]>`. Use `Gio.File.new_for_uri(uri).read_async` and then `GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream, 24, 24, true, …)`, average the RGB of opaque pixels with `get_pixels()`, then lift brightness to at least 0.6 (HSV V), as `ensureMinimumBrightness` does. Cache results in a `Map` by URI (bounded at about 50 entries).
2. `src/island.js` `_syncArt`: after resolving the URI, compute the colour and pass it to `LiveMediaView.setColor(rgb)` and `OpenView.setAccent(rgb)`.
3. `src/widgets.js` `Visualizer.setColor(rgb)`: set `bar.style = background-color: rgb(...)` on each bar (the bars are `St.Widget`s).
4. `src/openView.js`: tint the `bn-artist` and `bn-time` labels. For the slider, set the `Slider` style (`-barlevel-active-background-color: …`).
5. Schema: `colored-visualizer` (b, true), `player-tinting` (b, true), `slider-color` (s: `white|album|accent`, `white`). For `accent`, use `-st-accent-color` (St supports it, see 8.2).

**Testing:** Use the fake player with solid red, green and black PNG art. Assert the computed RGB through Eval and screenshot the bars.

**Risks:** Decoding happens off the main thread through the async pixbuf loader. Avoid synchronous `new_from_file_at_scale` on large art. No idle cost. Cancel the cancellable in `destroy()`.

**Effort / value:** S–M. Medium (the colour is what makes it look like boring.notch).

### 1.4 Album-art presentation: blurred glow, paused dimming and shrink, app-icon badge, app icon when there is no art

**boring.notch:** `NotchHomeView.swift` `AlbumArtView` (27–110). `lightingEffect` draws the cover blurred (radius 40, scaled 1.3×1.4, rotated 92°, opacity 0.5 while playing) behind the art. When paused, the art scales to 0.85 with a dark overlay. A 30 pt app icon badge sits at the bottom right (`appIconOverlay`). `MusicManager.updateFromPlaybackState` uses the app icon as artwork when there is none (`usingAppIconForArtwork`).

**Linux fit:** Fits. `Shell.BlurEffect` exists (used in `ui/unlockDialog.js` 732, and present in `Shell-18.typelib`). App icons come from `Shell.AppSystem.get_default().lookup_app(desktopEntry + '.desktop')?.get_icon()`, using MPRIS `DesktopEntry`, which `src/media.js` already reads.

**Implementation:**
1. `src/media.js`: expose `player.desktopEntry` (already in `MprisIface`).
2. `src/widgets.js` `AlbumArt`:
   - Add an optional `glow` child: a second `St.Bin` with the same `background-image`, `scale_x 1.3`, `scale_y 1.4`, `rotation_angle_z 92`, `opacity 128`, and `add_effect(new Shell.BlurEffect({radius: 40, mode: Shell.BlurMode.ACTOR}))`. Put it behind the art inside a `Clutter.BinLayout`. Show it only while playing.
   - `setPlaying(p)`: ease `scale_x/scale_y` to `1 : 0.85` and the opacity of a black overlay to `0 : 200`.
   - `setBadge(gicon)`: a `St.Icon` (icon-size 30) aligned to the bottom right with translation +10/+10.
3. `src/openView.js` `MediaPlayer.update`: pass `playing` and the app icon. When `artUri` is null, show the app icon instead of the music-note placeholder.
4. Schema: `album-art-glow` (b, true). Prefs row in Appearance.

**Testing:** Screenshot playing vs paused. Measure CPU with the notch open and playing. A blur effect on a static actor is cached, so it should add almost nothing. Confirm that.

**Risks:** `Shell.BlurEffect` repaints when the actor is damaged; keep the glow static (no per-frame changes). The notch clips to its allocation (`clip_to_allocation: true`), so a scaled glow is clipped cleanly. Cleanup comes from the actor tree.

**Effort / value:** S. Medium.

### 1.5 Lyrics under the artist name (synced when available)

**boring.notch:** `MusicManager.swift` 343–507. It queries `https://lrclib.net/api/search?track_name=…&artist_name=…` (no auth), parses `syncedLyrics` LRC (`parseLRC`) and picks the current line by binary search (`lyricLine(at:)`). It falls back to plain lyrics, and uses Apple Music's own lyrics through AppleScript. Shown in `NotchHomeView.swift` 156–188 as a marquee, refreshed every 0.25 s. Setting `enableLyrics` (default off, "Beta").

**Linux fit:** Fits. `Soup` 3 is already imported in `src/art.js`. Some MPRIS players publish lyrics in `xesam:asText` metadata, which can be used before any network request.

**Implementation:**
1. New `src/lyrics.js` `LyricsService`: `fetch(title, artist, lengthUs) → {synced: [{t, text}], plain}`.
   - Order: (a) `xesam:asText` from the metadata, (b) on-disk cache `~/.cache/boring-notch-linux/lyrics/<sha256>.json`, (c) `GET https://lrclib.net/api/get?track_name=&artist_name=&duration=` (exact match), then `/api/search` as a fallback.
   - Set a `User-Agent` such as `boring-notch-linux/<version> (+repo url)`, as LRCLIB asks.
   - Parse `[mm:ss.xx]` lines.
2. `src/openView.js` `MediaPlayer`: add a `bn-lyric` label under the artist. In the existing `tick()` (500 ms, only while open; see `OpenView.startTicking`), binary-search the line for `player.position`. Show "Loading lyrics…" and "No lyrics found" as boring.notch does.
3. `src/island.js`: request lyrics on `'track-changed'` (from 1.1), only when `show-lyrics` is on. Cancel the previous request.
4. Schema: `show-lyrics` (b, false). The prefs subtitle must say that the title and artist are sent to lrclib.net.
5. README Privacy section: add a paragraph.

**Testing:** Unit-test the LRC parser with a fixture. In the headless shell, set `xesam:asText` on the fake player to avoid the network, and run one manual online test.

**Risks:** Privacy, because it sends track metadata to a third party, so keep it opt-in and off by default. Network errors must fail quietly. It only works while open, so there is no idle cost. Cancel Soup on disable (`ArtCache` already shows how).

**Effort / value:** M. Medium (people who notice it love it).

### 1.6 Marquee scrolling for long titles

**boring.notch:** `components/Live activities/MarqueeTextView.swift`. When text is wider than its frame, it scrolls linearly at about 30 pt/s after a delay (`minDuration`). It is used for the title, artist, lyric and sneak peek.

**Linux fit:** Fits, using `St.Label` inside a clipped `St.Widget` and `ease({translation_x})`.

**Implementation:**
1. `src/widgets.js` `MarqueeLabel extends St.Widget` (`clip_to_allocation: true`) wrapping an `St.Label`. On `notify::allocation` or a text change, compare the label's natural width with the allocated width. If it overflows and `this._active`, wait 1 s, ease `translation_x` to `-(overflow + gap)` over `overflow/30 s`, pause, and snap back. Repeat at most twice per track, then stop at the start with an ellipsis.
2. Use it for the title, artist and lyric in `MediaPlayer`, and in `MusicPeekView`.
3. Call `setActive(open)` from `OpenView.startTicking/stopTicking` so nothing animates while closed or parked.

**Risks:** Continuous easing redraws the open notch at 60 fps (the README already found easing costs about 10% CPU for the visualizer). That is why scrolling is limited to two passes and only runs while open. Cleanup: `remove_all_transitions()` on destroy.

**Effort / value:** S. Medium.

### 1.7 Media inactivity timeout and a switch for the music live activity

**boring.notch:** `waitInterval` (0–10 s, default 3) is how long the live activity stays after pause (`MusicManager.updateIdleState`). `musicLiveActivityEnabled` ("Show music live activity", `BoringViewCoordinator.swift`, Media pane).

**Linux fit:** Trivial. The port hard-codes `PAUSE_LINGER_MS = 3000` and has only `show-visualizer`.

**Implementation:** Schema `media-linger-seconds` (i, 0–10, default 3) and `show-media-activity` (b, true). In `Island._syncMedia`, read the linger value. In `_currentClosedView`, skip `_liveMedia` when the setting is off. Prefs: `Adw.SpinRow` and `Adw.SwitchRow` in the Media page, with `show-visualizer` sensitive only when the activity is on.

**Effort / value:** S. Low–Medium.

### 1.8 Fullscreen behaviour: hide for all apps / hide only for the media app / never hide

**boring.notch:** `observers/FullscreenMediaDetection.swift`, `BoringViewModel.setupDetectorObserver` (`hideOnClosed`), and `hideNotchOption` (`always|nowPlayingOnly|never`, default `nowPlayingOnly`, "Beta", Media pane).

**Linux fit:** Fits. The port uses `addTopChrome(island, {trackFullscreen: true})`, which always hides it. Confirmed APIs: `global.display` `'in-fullscreen-changed'` and `global.display.get_monitor_in_fullscreen(i)` (`ui/layout.js` 168, 342), and `Shell.WindowTracker.get_default().get_window_app(win)` to match the fullscreen window to the player's `DesktopEntry`.

**Implementation:**
1. `extension.js`: when `fullscreen-behavior` is not `always`, call `addTopChrome(island, {trackFullscreen: false})`. Re-add the chrome on setting change: `removeChrome` then `addTopChrome`.
2. `src/island.js` `_syncFullscreen()` on `in-fullscreen-changed`, `notify::focus-window` and media `changed`. Find the fullscreen window on the island's monitor (`global.display.list_all_windows().find(w => w.is_fullscreen() && w.get_monitor() === idx)`). In `media` mode, hide when its app id equals `player.desktopEntry + '.desktop'`.
3. Keep the default `always` (today's behaviour). Showing over fullscreen games and videos by default would surprise GNOME users, even though boring.notch defaults to `nowPlayingOnly`.
4. Prefs ComboRow in Media.

**Testing:** Run `gnome-text-editor` and a fake player whose `DesktopEntry` matches. Toggle `make_fullscreen()` through Eval and assert `island.visible`.

**Risks:** A visible notch steals clicks at the top edge of fullscreen apps (chrome input region). Cleanup: disconnect the display signals.

**Effort / value:** S–M. Low–Medium.

### 1.9 Choosing the music source → preferred and ignored players

**boring.notch:** `mediaController` (Now Playing / Apple Music / Spotify / YouTube Music), `MediaControllers/*.swift`, the Media pane "Music Source" picker, and `Onboarding/MusicControllerSelectionView.swift`.

**Linux fit:** The per-app controllers are not needed, because MPRIS covers every player. The useful equivalent is to prefer one player and ignore others (for example, ignore a browser tab's video when Spotify is open).

**Implementation:** Schema `preferred-player` (s, '' = automatic), `ignored-players` (as). `MediaManager.activePlayer` filters out ignored bus names and identities and puts the preferred one first. Prefs: a ComboRow filled from the session bus (`ListNames` filtered by `org.mpris.MediaPlayer2.`, read `Identity`), plus an `Adw.ExpanderRow` of switches for the ignore list.

**Effort / value:** S. Low–Medium.

### 1.10 Custom Lottie visualizers: not proposed (see section 11)

---

## 2. HUD (volume, brightness, keyboard backlight, microphone)

### 2.1 "Default" HUD style (a row under the notch) next to today's inline style

**boring.notch:** `components/Live activities/SystemEventIndicatorModifier.swift`. With `inlineHUD = false` (the default), the closed notch grows down by one row showing the icon, a draggable bar and an optional percentage (`ContentView.swift` 303–323). `InlineHUD.swift` is the inline style the port already copies. Setting: HUD pane → "HUD style".

**Linux fit:** Fits. It uses the same `extraHeight()` mechanism as 1.1's standard sneak peek.

**Implementation:** Add a `secondRow` mode to `InlineHudView` (or a new `RowHudView`): the left/right layout moves into a row below the panel line. `hud-style` (s: `inline|row`, default `inline`). `Island.showHud` picks the view. Relayout already animates the height.

**Effort / value:** S (after 1.1). Low–Medium.

### 2.2 Draggable HUD bar to set the level

**boring.notch:** `DraggableProgressBar` in `SystemEventIndicatorModifier.swift`. Its value feeds `VolumeManager.setAbsolute` and `BrightnessManager.setAbsolute` (`managers/VolumeManager.swift`, `managers/BrightnessManager.swift`).

**Linux fit:** Fits with confirmed APIs:
- Volume: `getMixerControl()` exported from `ui/status/volume.js` (line 22) → `get_default_sink()`, `stream.volume = v * control.get_vol_max_norm(); stream.push_volume()`.
- Screen brightness: `Main.brightnessManager.globalScale.value` (`misc/brightnessManager.js`, `BrightnessScale.value` is read/write, created in `ui/main.js` 278).
- Keyboard backlight: no public setter in JS. Leave it read-only.
- The OSD override does not say which control changed, so infer it from the icon name (`audio-volume-*`, `display-brightness-*`, `keyboard-brightness-*`, `microphone-*`).

**Implementation:** In `src/closedViews.js`, swap `BarLevel` for a reactive `Slider.Slider` (the `ui/slider.js` subclass of BarLevel) when the type is volume or brightness. `notify::value` → setter. While dragging, keep the peek alive (`Island` keeps re-arming the `'sneak'` timeout while `slider.dragging`) and stop the hover-open timer. Clicks on a HUD peek must not open the notch: in `Island`'s `button-press-event`, skip when the event source is inside the slider.

**Testing:** Use Eval to call `Main.osdWindowManager.show(...)` with a volume icon, then set `slider.value = 0.3` and assert `getMixerControl().get_default_sink().volume`. Headless has a null sink, which should still accept volume. **(verify)**

**Risks:** The volume writes go through a private GNOME module (`ui/status/volume.js` is internal, though stable). Calling `push_volume` triggers a new OSD and so recursion into `showHud`. Guard it with a `_settingLevel` flag.

**Effort / value:** M. Medium.

### 2.3 HUD inside the open notch, and percentage switches

**boring.notch:** `OpenNotchHUD.swift`. While open, the header swaps its camera/settings/battery buttons for a capsule with the icon, bar and percentage (`BoringHeader.swift` 37–41). Keys: `showOpenNotchHUD`, `showOpenNotchHUDPercentage`, `showClosedNotchHUDPercentage`.

**Linux fit:** Fits. Today, when the notch is open, `Island.showHud` returns false and the GNOME OSD shows instead.

**Implementation:** `src/openView.js` `Header.showHud(icon, level, max)`: hide `_batteryBox` and the gear and show a capsule `St.BoxLayout` (icon + `BarLevel` + label) for 1.5 s. `Island.showHud`, when open and `show-open-hud` is on, calls it and returns true. Schema: `show-open-hud` (b, true), `hud-percentage-open` (b, true), `hud-percentage-closed` (b, true, which matches the port today). `InlineHudView.update` hides `_value` when that setting is off.

**Effort / value:** S. Medium (it removes the jarring GNOME popup while the notch is open).

### 2.4 HUD bar look: gradient, glow, accent tint

**boring.notch:** `enableGradient` ("Hierarchical"/"Gradient"), `systemEventIndicatorShadow` (glow), `systemEventIndicatorUseAccent` (`DraggableProgressBar`).

**Linux fit:** Partly. `BarLevel` draws with Cairo from CSS properties (`-barlevel-active-background-color`), so accent tint is easy. A gradient or glow needs a custom repaint. Glow can be approximated with `box-shadow` on the bar actor.

**Implementation:** `hud-accent` (b, false) switches the bar's style to `-barlevel-active-background-color: -st-accent-color`. Leave gradient and glow out unless users ask.

**Effort / value:** S (accent only). Low.

### 2.5 Option-key media-key actions: not proposed (see section 11)

---

## 3. Battery

### 3.1 Battery details popover (from the header battery)

**boring.notch:** `components/Live activities/BoringBattery.swift` `BatteryMenuView` and `BoringBatteryView`. It shows percentage, max capacity, low power mode, charging, plugged in, time to full, "Charging on hold" when plugged in, not charging and ≥80%, and a "Battery Settings" button. The notch stays open while the popover is up (`vm.isBatteryPopoverActive` in `ContentView.swift`).

**Linux fit:** Fits with the confirmed UPower properties on this machine:
- DisplayDevice: `TimeToEmpty`, `TimeToFull`.
- The real battery (`BAT0`): `Capacity` (69.85% here), `ChargeThresholdEnabled`, `ChargeThresholdSupported` (read with `upower -d` / `gdbus introspect`).
- Power saver: `org.freedesktop.UPower.PowerProfiles` → `ActiveProfile` (read/write). The settings button runs `gnome-control-center power`.

**Implementation:**
1. `src/battery.js`: add `TimeToEmpty`, `TimeToFull` and `Type` to `DeviceIface`. Call `org.freedesktop.UPower.EnumerateDevices` once and keep proxies for `Type == 2` (battery) devices, reading `Capacity`, `ChargeThresholdEnabled` and `ChargeThresholdSupported`. Add a `PowerProfiles` proxy (`ActiveProfile`) that emits `'changed'`. All of this is signal driven, with no polling.
2. `src/openView.js`: make `_batteryBox` an `St.Button`. When clicked, it toggles `BatteryPanel`, a small `St.BoxLayout` drawn *inside* the open notch over the page area (a separate shell popup would fight the hover-close logic). Rows: "Battery 82%", "Health 70%", "Time to full 1 h 20 min" / "Time left 2 h 40 min", "Power Saver: On" (a switch writing `ActiveProfile`), "Charging limited to 80%" when the threshold is enabled, and a "Power Settings…" button.
3. `src/island.js`: while the panel is open, `OpenView.busy` returns true so hover-out does not close the notch (the seek-bar drag already uses this).

**Testing:** dbusmock upower template with a battery device. Assert the strings through Eval and take screenshots.

**Risks:** Desktops have no battery, so hide everything when `present` is false (already handled). Laptops without threshold support: hide that row. Writing `ActiveProfile` may need polkit on some distros **(verify; on GNOME it is normally allowed)**. Cancel the proxies in `destroy()`.

**Effort / value:** M. Medium.

### 3.2 Battery display options and colour coding

**boring.notch:** `showBatteryIndicator`, `showBatteryPercentage`, `showPowerStatusIcons`, `showPowerStatusNotifications` (the port has the last one as `show-battery-activity`). `BatteryView` (in `BoringBattery.swift`) colours the fill red at ≤20% when unplugged, green when charging, plugged or full, and yellow in low power mode.

**Linux fit:** Trivial.

**Implementation:** Schema `show-battery-indicator` (b, true), `show-battery-percentage` (b, true), `show-power-icons` (b, true). Use them in `Header._syncBattery` and `BatterySneakView`. For colour coding, replace the theme icon with a small drawn battery (`St.DrawingArea`: an outline, a fill rect in a state colour, and a bolt or plug glyph when `show-power-icons`), or keep the symbolic icon and tint it with `style = 'color: …'`. Tinting is cheaper and enough.

**Effort / value:** S. Low–Medium.

### 3.3 Power-saver peek and clearer status text

**boring.notch:** `BatteryStatusViewModel.swift` 53–107. It peeks on a low power mode change ("Low Power: On/Off"), and status text "Charging battery" / "Not charging" / "Full charge".

**Linux fit:** Fits (PowerProfiles `ActiveProfile` changes).

**Implementation:** `BatteryMonitor` emits `'power-saver'` when `ActiveProfile` enters or leaves `power-saver`. `Island._onPowerSaver()` reuses `BatterySneakView` with the status text. In `BatterySneakView.update`, use the State values `PENDING_CHARGE` ("Not charging") and `FULLY_CHARGED` ("Full").

**Effort / value:** S. Low.

---

## 4. Calendar

The port's Today tab uses GNOME's `Calendar.DBusEventSource`. Its events carry only `id, date, end, summary` (`ui/calendar.js` 79–86). The id starts with the Evolution Data Server (EDS) source UID followed by `\n` (`_onClientDisappeared`, lines 337–343). Colour, calendar names and "selected" flags live in `~/.config/evolution/sources/<uid>.source` key files (`[Calendar] Color=#62a0ea`, `Selected=true`, `[Data Source] DisplayName=`; confirmed on this machine). Reading those key files with `GLib.KeyFile` avoids the ECal/EDataServer typelibs, which are **not installed** here (no `ECal-2.0`/`EDataServer-1.2` typelibs).

### 4.1 Event list options: colours, hide all-day, full titles, auto-scroll to next, dim past events, birthdays, click to open

**boring.notch:** `components/Calendar/BoringCalendar.swift` `EventListView` (266–440): a colour bar per calendar, location line, `hideAllDayEvents`, `showFullEventTitles` (2 lines vs unlimited), `autoScrollToNextEvent` (scroll to the first upcoming non-all-day event), past events at 0.6 opacity, and a click that opens Calendar (`EventModel.calendarAppURL()`). `EventModel.swift` has event / birthday / reminder types.

**Linux fit:** Mostly fits:
- Colour comes from the source key file.
- Birthdays come from source uid `birthdays`.
- Click to open: `gnome-calendar --uuid <event id>` (the option exists, `-u, --uuid  Open calendar showing the passed event`, checked with `gnome-calendar --help`). Its expected id format must be confirmed against the CalendarServer id **(verify)**. The fallback is `gnome-calendar --date <date>`.
- Location is **not** available from `DBusEventSource`. Leave it out (or add it with the EDS work in 4.3).

**Implementation:**
1. New `src/calendarSources.js` `CalendarSources`: read `GLib.get_user_config_dir()/evolution/sources/*.source` once. Watch the directory with `Gio.FileMonitor`, which is signal driven. Map `uid → {name, color, kind: 'calendar'|'tasks'|'birthdays', selected}`.
2. `src/openView.js` `TodayView._syncEvents`:
   - Per row: a 3 px colour bar (`St.Widget`, `style background-color`), the summary (`clutter_text.line_wrap` plus `ellipsize` per `full-event-titles`), the time range ("09:00 – 10:00", formatted like `dateMenu.js` `_formatEventTime`), and a cake icon for birthdays.
   - Skip all-day events when `hide-all-day-events` is on.
   - Rows are `St.Button`s that launch Calendar (`Gio.Subprocess` / `Shell.AppSystem.lookup_app('org.gnome.Calendar.desktop').launch(...)` with args), then close the notch.
   - Dim ended events (`opacity 150`) when the selected day is today.
   - After building, if `auto-scroll-next-event`, scroll the `St.ScrollView` so the first event with `end > now` is at the top (`scroll.vadjustment.value = row.y`).
3. Schema: `hide-all-day-events` (b, false), `full-event-titles` (b, false), `auto-scroll-next-event` (b, true). A new **Calendar** prefs page.

**Testing:** The mock CalendarServer emits events with uids that match a temporary `$XDG_CONFIG_HOME/evolution/sources/test.source`. Screenshot. Assert the scroll position.

**Risks:** The key file format is an EDS on-disk detail. Online-account sources (Google through GOA) may not always have a `.source` file, so fall back to a neutral grey. Today ending: `_syncEvents` already runs on `changed`. There is no ticking, so dimming "now" only updates when the tab opens, which is fine.

**Effort / value:** M. Medium.

### 4.2 Choosing which calendars show

**boring.notch:** `CalendarSettings` in `SettingsView.swift` (734–805): toggles per calendar and reminder list, `calendarSelectionState` (all / selected set), `CalendarManager.setCalendarSelected`.

**Linux fit:** Fits for the event *list* (filter by source uid). The month grid's event dots come from GNOME's `Calendar.Calendar` and the same event source, so filter there too. Wrap `DBusEventSource` in a filtering `EventSourceBase` subclass (`ui/calendar.js` exports `EventSourceBase`, line 91) that delegates `requestRange`/`getEvents`/`hasEvents` and drops hidden uids. GNOME's own "Selected" flag (set in GNOME Calendar) already applies upstream, so this is a notch-only filter.

**Implementation:** Schema `hidden-calendars` (as, []). `src/calendarSources.js` provides the list. In prefs, the extension reads the same key files (the prefs process can read `~/.config` too) and shows an `Adw.SwitchRow` per calendar with a colour dot. In `TodayView`, use `new FilteredEventSource(new Calendar.DBusEventSource(), settings)` and call it on both `Calendar.setEventSource` and the list.

**Risks:** `EventSourceBase` is a private GNOME class, so it may change between GNOME versions. Pin it with a version check.

**Effort / value:** S–M. Low–Medium.

### 4.3 Reminders / tasks with completion toggles

**boring.notch:** `CalendarManager.swift` (EventKit reminders), `ReminderToggle` and `setReminderCompleted` in `BoringCalendar.swift` (345–370, 445+), `hideCompletedReminders`.

**Linux fit:** Possible, but GNOME Shell has no task API. Tasks live in EDS task lists (Endeavour / GNOME To Do / Evolution, e.g. `system-task-list.source` here). Reading them needs either the optional `gi://ECal?version=2.0` + `gi://EDataServer?version=1.2` typelibs (Ubuntu packages `gir1.2-ecal-2.0`, `gir1.2-edataserver-1.2`; not installed on this machine) or a hand-written client for the EDS calendar factory D-Bus API (complex).

**Implementation:**
1. `src/tasks.js`: a guarded dynamic `import('gi://ECal?version=2.0')`. If it is missing, the feature is hidden in prefs with a hint to install the package.
2. Use `EDataServer.SourceRegistry.new` (async) → task-list sources → `ECal.Client.connect` (async, `ECal.ClientSourceType.TASKS`) → `get_object_list_as_comps` (async) for `(due-in-time-range …)` today, plus a `ClientView` for live updates.
3. Show tasks in `TodayView` above the events with an `St.Button` check toggle. Completion uses `ECal.Component` status `COMPLETED` → `client.modify_object`.
4. Schema `show-tasks` (b, false), `hide-completed-tasks` (b, true).

**Testing:** A local EDS in the headless session (`evolution-data-server` services run on the private session bus) with a seeded `.ics` task list. This is heavier.

**Risks:** An optional dependency. Async EDS calls must all be cancellable. A ClientView keeps a D-Bus subscription, but there is no polling. Writing tasks is a new class of side effect, so test it carefully.

**Effort / value:** L. Low–Medium.

### 4.4 Compact "Up next" calendar on the Home tab

**boring.notch:** `NotchHomeView.swift` `mainContent` (442–466). With `showCalendar`, the Home view shows the player and a 215 pt calendar column: a horizontal day wheel (`WheelPicker`, with haptic ticks) and that day's events.

**Linux fit:** Fits. The port already has a full Today tab, so the gain is a glanceable next event beside the player.

**Implementation:** `UpNextView` in `src/openView.js` (about 200 px wide) with the next 2 events from the shared event source. `OPEN_SIZES.home.width` grows to 640 + about 180 when on. Optionally, a 7-day strip of `St.Button`s instead of the wheel. Schema `home-calendar` (b, false).

**Effort / value:** S–M. Low–Medium.

---

## 5. Shelf (file drop tray), Quick Look and Quick Share

This is boring.notch's signature feature and the hardest one to port, because of Wayland.

**boring.notch:**
- `components/Shelf/` (models `ShelfItem.swift` file/text/link kinds and `Bookmark.swift`; services Drop, Persistence (`items.json`), Thumbnail, QuickLook, QuickShare, ShareServiceFinder, TemporaryFileStorage, ImageProcessing; view models; views `ShelfView.swift`, `ShelfItemView.swift`, `FileShareView.swift`).
- `observers/DragDetector.swift` (global mouse plus drag pasteboard monitoring, so dragging a file towards the notch opens it), `ContentView.swift` `dragDetector` / `onDrop` (lines 217–243, 364, 489–503).
- Tabs `Home | Shelf` (`components/Tabs/TabSelectionView.swift`, shown when the shelf has items or `alwaysShowTabs`).
- Context menu (`ShelfItemViewModel.swift` 210–371): Open, Open With, Show in Finder, Quick Look, Share…, Image Actions (Remove Background, Convert…, Create PDF), Compress, Rename, Copy, Copy Path, Remove. Multi-select and drag out to other apps.
- Settings (Shelf pane): `boringShelf`, `openShelfByDefault`, `shelfTapToOpen`, `expandedDragDetection`, `copyOnDrag`, `autoRemoveShelfItems`, `quickShareProvider`.

**The Wayland constraint (checked in the shell source):** GNOME Shell sees a client drag only through `global.backend.get_dnd()` signals `dnd-enter`, `dnd-position-change` and `dnd-leave` (`ui/xdndHandler.js`; the `Meta.Dnd` signals are confirmed in `Meta-18.gir` 4743–4765). It is told *that* a drag is over a point. It cannot read the dragged data or accept the drop. Shell actors are not Wayland clients, and no shell code accepts a drop from `Main.xdndHandler` beyond hover-to-activate (`workspaceThumbnail.js` 518, `panel.js` 231). It also cannot *start* a drag that carries files to other apps. So:
- **Detecting a drag near the notch and opening the Shelf tab** works in pure shell code.
- **Receiving the drop and dragging items out** need a small helper Wayland client (GTK 4) whose window sits under the open notch while a drag is in progress. Mutter-18 has the pieces: `Meta.WaylandClient.new_subprocess(context, launcher, argv)`, `.owns_window(win)`, `.get_subprocess()`, and on `Meta.Window`: `move_frame`, `make_above`, `stick`, `hide_from_window_list`, `set_type` (all confirmed in `Meta-18.gir`). Desktop Icons NG uses the same technique.

### 5.1 Shelf tab without drag and drop (phase A)

**Implementation:**
1. New `src/shelf.js` `ShelfStore extends EventEmitter`: items `{id, kind: 'file'|'text'|'link', uri|text, added}`, persisted to `~/.local/share/boring-notch-linux/shelf.json` (write on change, asynchronously). Text and link drops are kept as data (boring.notch writes temporary files; that is only needed for drag-out).
2. Ways to add items without DnD:
   - A "Paste" button in the Shelf tab that reads `St.Clipboard.get_default().get_content(St.ClipboardType.CLIPBOARD, 'text/uri-list', cb)` (Files copies use `text/uri-list` and `x-special/gnome-copied-files`), falling back to `get_text` for text and links (`St.Clipboard.get_content/get_mimetypes/set_content` confirmed in `St-18.typelib`).
   - An "Add finished downloads to the shelf" option (reuse `DownloadWatcher`'s `'finished'`).
   - An "Add new screenshots" option (watch `~/Pictures/Screenshots` with `Gio.FileMonitor`).
3. New `src/shelfView.js` `ShelfView` page: a horizontal `St.ScrollView` of `ShelfItem` tiles (88×88 thumbnail plus a one-line name).
   - Thumbnail: `Gio.File.query_info_async('thumbnail::path,standard::icon,standard::content-type')`. Use the cached XDG thumbnail when present. For images without one, use `GdkPixbuf.new_from_stream_at_scale_async` to 128 px. Otherwise use the content-type icon.
   - Empty state: "Drop files here".
   - Click selects, Ctrl-click multi-selects, double-click opens (`Gio.AppInfo.launch_default_for_uri_async`).
4. Context menu on right click: a `PopupMenu.PopupMenu` anchored to the tile, with `Main.uiGroup.add_child(menu.actor)` and a `PopupMenuManager`. While it is open, `OpenView.busy` stays true. Items:
   - Open
   - Open With → `Gio.AppInfo.get_all_for_type(contentType)` submenu
   - Show in Files → D-Bus `org.freedesktop.FileManager1.ShowItems(as uris, s startupId)`
   - Quick Look → GNOME Sushi `org.gnome.NautilusPreviewer2.ShowFile(s uri, s windowHandle, b closeIfShown, s activationToken)` (signature confirmed with `gdbus introspect` on this machine, `/usr/bin/sushi` installed). Pass `''` for the handle.
   - Copy → `St.Clipboard.set_content(CLIPBOARD, 'text/uri-list', bytes)`
   - Copy Path → `set_text`
   - Rename → inline `St.Entry` and `Gio.File.set_display_name_async`
   - Compress → `Gio.Subprocess` `['file-roller', '--add-to=…zip', …]` or `zip` when present (optional)
   - Remove from Shelf
5. Tabs: add `{id: 'shelf', label: 'Shelf', icon: 'folder-symbolic'}` to `TABS` and `OPEN_SIZES.shelf = {640, 190}`. When the notch closes, go back to Home unless the shelf has items and `open-shelf-by-default` (mirrors `BoringViewModel.close()`).
6. Schema: `enable-shelf` (b, true), `open-shelf-by-default` (b, true), `shelf-add-downloads` (b, false), `shelf-add-screenshots` (b, false). A **Shelf** prefs page.

### 5.2 Drag files onto the notch to add them (phase B: helper client)

1. New `helper/shelf-drop.js` (GJS + GTK 4, run as `gjs -m`): a borderless `Gtk.Window` (no decorations, transparent CSS background) of the open notch size, with a `Gtk.DropTarget` for `Gdk.FileList`, plus `Gtk.DropTarget` for `GObject.TYPE_STRING` for text and links. On drop, it prints one JSON line per item to stdout. On `dnd-leave` it is told over stdin to hide.
2. `src/shelfDrop.js` in the shell:
   - On `Main.xdndHandler` `'drag-begin'` (it is an `EventEmitter`; `messageTray.js` 789 also listens), start or reuse the helper with `Meta.WaylandClient.new_subprocess(global.context, launcher, argv)`, with `launcher` flags `STDIN_PIPE|STDOUT_PIPE`.
   - On `global.display` `'window-created'`, match `client.owns_window(win)` → `win.hide_from_window_list()`, `make_above()`, `stick()`, and `move_frame(false, x, y)` to the open-notch rectangle below the panel. Set the window actor's opacity to 0: the visuals are drawn by the shell ShelfView, and the helper only takes the drop.
   - Use `dnd-position-change` (from `global.backend.get_dnd()`) to open the island on the Shelf tab once the pointer enters the notch region (or an expanded region with `expanded-drag-detection`, mirroring `DragDetector.swift`), and highlight the dashed drop border.
   - While a drag is in progress, set the island and its open view `reactive = false` so Clutter picking reaches the helper's window actor under it **(verify that Mutter's Wayland drag focus follows the Clutter pick)**.
3. Keep the helper alive for about 60 s after the last drag, then exit. Spawning `gjs` + GTK 4 takes about 0.3–0.6 s, so the first drag after a cold start may arrive before the window exists. Keep the drop region large (the whole open notch) and start the helper on `drag-begin`, before the pointer reaches the notch.
4. Schema `expanded-drag-detection` (b, true).

### 5.3 Dragging items out to other apps (phase C, optional)

The shell cannot start a Wayland drag with file data. Options: (a) while the Shelf tab is open, put the helper window over the tiles and use `Gtk.DragSource` there, with the helper drawing the tiles itself. That duplicates the UI. (b) Provide Copy, Open With and Show in Files instead, and skip drag-out. **Recommendation: (b)** unless users ask. `copy-on-drag` and `auto-remove-after-drag` only make sense with (a).

### 5.4 Quick Share drop zone

**boring.notch:** `FileShareView.swift` (a square drop zone left of the shelf; dropping shares immediately, clicking opens a file picker) and `QuickShareService.swift` (providers found at runtime through `NSSharingService`, AirDrop first, plus "System Share Menu").

**Linux equivalents** (provider discovery is just "is it installed"):
- **GSConnect** (phones over KDE Connect): session D-Bus `org.gnome.Shell.Extensions.GSConnect`, devices under `/org/gnome/Shell/Extensions/GSConnect/Device/<id>`, activate the `org.gtk.Actions` action `shareFile` with `(sb)` (uri, open) **(verify the action name and signature against the GSConnect source)**. GSConnect is not installed on this machine.
- **Bluetooth**: `/usr/bin/bluetooth-sendto <files>` (installed).
- **LocalSend** (AirDrop-like, cross-platform): `/snap/bin/localsend` (installed). It has no stable CLI for sending files, so launch it with files as args **(verify)**.
- **Email**: `xdg-email --attach` (installed).
- **Nautilus "Send To"**: same as above.
There is no xdg-desktop-portal share portal.

**Implementation:** `src/share.js` `ShareProviders.list()` checks for binaries (`GLib.find_program_in_path`) and the GSConnect bus name, and fills a ComboRow (`quick-share-provider`, s). Add a "Share…" context-menu item and a drop zone tile in ShelfView (dropping onto it needs the 5.2 helper, so add a second drop region in the helper and report `{zone: 'share'}`).

### 5.5 Image actions (remove background, convert, create PDF): not proposed (see section 11)

**Testing (whole Shelf):** Phase A runs fully headless: copy a uri-list to the clipboard through Eval (`St.Clipboard.set_content`), press Paste, and assert `shelf.json`. Phase B: launch a GTK 4 test client that starts a `Gtk.DragSource` and drives the pointer with the virtual device (`notify_button`, `notify_relative_motion`). This is fragile in headless mode, so add a manual test checklist on a real session (Files → notch, Firefox image → notch).

**Risks (whole Shelf):** Wayland focus and stacking behaviour for helper windows is the biggest risk. It could break with Mutter changes, so gate phase B behind `enable-shelf-drop` (default on only after testing). Idle cost: none in phase A. In phase B, the helper process exists only after a drag and for 60 s. Memory is about 30–40 MB while alive. Privacy: the shelf stores paths, not copies (boring.notch uses bookmarks), so tell users in the README that the shelf is a list of links. Cleanup in `disable()`: kill the helper (`get_subprocess().force_exit()`), disconnect `xdndHandler` and display signals, and flush `shelf.json`.

**Effort / value:** Phase A **M**, phase B **L**, phase C **L**, Quick Share **S–M** once A/B exist. Value **High**: it is what boring.notch is known for, and Linux users have no equivalent in the top bar.

---

## 6. Webcam mirror

**boring.notch:** `components/Webcam/WebcamView.swift` (square preview, horizontally mirrored, circle or rounded-rectangle shape, tap to start or stop, "Mirror"/"Access Denied" placeholder) and `managers/WebcamManager.swift` (AVCaptureSession start/stop, device connect/disconnect). The camera button is in the header (`BoringHeader.swift` 43–58) and toggles `vm.isCameraExpanded`. The preview sits right of the player and calendar (`NotchHomeView.swift` 456–462). Settings: `showMirror` (off by default, disabled without a camera), `mirrorShape`.

**Linux fit:** Fits, with care. GStreamer `pipewiresrc` and `v4l2src` are installed (checked with `gst-inspect-1.0`). Run capture **out of process**, the way `src/audio.js` does, so a camera stall cannot freeze the shell. Pipe small raw RGBA frames to the shell and upload them with `St.ImageContent.set_bytes(coglContext, bytes, Cogl.PixelFormat.RGBA_8888, w, h, stride)` (the exact GNOME 50 call is in `ui/screenshot.js` 2335–2346 and `ui/qrCode.js` 91–103). Use `pipewiresrc` so GNOME's own camera-in-use indicator (`ui/status/camera.js`, `Shell.CameraMonitor` 'cameras-in-use') turns on while the mirror runs.

**Implementation:**
1. New `src/camera.js` `CameraFeed extends EventEmitter`:
   - `start()` spawns `gst-launch-1.0 -q pipewiresrc ! videoconvert ! videoscale ! videoflip method=horizontal-flip ! video/x-raw,format=RGBA,width=160,height=160,pixel-aspect-ratio=1/1,framerate=24/1 ! fdsink fd=1`. If pipewiresrc fails within 2 s, fall back to `v4l2src`. Choosing a specific camera: `pipewiresrc target-object=<serial>` from `pw-dump`, later.
   - Read with `Gio.DataInputStream.read_bytes_async(160*160*4)` in a loop on the main context and emit `'frame'` with `GLib.Bytes`.
   - `stop()` calls `force_exit()`, cancels reads and emits `'stopped'`.
   - A test override lets an env var or GSettings key set the pipeline source (`videotestsrc`).
2. New `MirrorView extends St.Widget` in `src/openView.js`: 160×160 (zoom-scaled) with an `St.ImageContent` set once. Each frame calls `content.set_bytes(...)` (the actor redraws). Shape: a cheap overlay `St.DrawingArea` repainted only on resize, which paints the notch's black outside a circle or rounded rectangle. That works because the notch background is solid black, and St border-radius does not clip `ClutterContent`.
3. `Header`: a camera `iconButton('camera-web-symbolic')` when `show-mirror` is on. It toggles `OpenView.setMirror(true)`, which adds the mirror to the Home page and widens `OPEN_SIZES.home` by about 180 px. Stop the feed when the notch closes (`Island.close()` → `openView.stopMirror()`), on tab change and on disable.
4. Schema `show-mirror` (b, false), `mirror-shape` (s: `circle|rounded`, `rounded`). Prefs live in Appearance → Additional features, with the subtitle "The camera runs only while the mirror is showing".

**Testing:** Use the `videotestsrc` override in headless mode and assert frames arrive (count emits over 2 s ≈ 48). Screenshot. Measure CPU with the mirror on (expected a few % of a core: 160²·4·24 ≈ 2.4 MB/s plus a texture upload). Confirm it drops to idle after close.

**Risks:**
- Privacy: start only on an explicit click, never on hover. Show GNOME's camera indicator (pipewiresrc) and never record.
- Sandboxing: the shell is a host process, so PipeWire camera access is usually allowed by WirePlumber without the portal **(verify on Ubuntu 26.04 WirePlumber policy)**.
- Exclusive v4l2 devices fail if a video call is using the camera; show "Camera busy".
- Performance: a 30 fps redraw of the open notch while visible only.
- Cleanup: kill gst on close and on disable.

**Effort / value:** M. Medium (a fun, visible feature that is hard to find elsewhere on Linux).

---

## 7. Interaction

### 7.1 Gestures: two-finger swipe down to open, swipe up to close, sensitivity

**boring.notch:** `ContentView.swift` `handleDownGesture`/`handleUpGesture` (562–611), `extensions/PanGesture.swift`, and the scale feedback `gestureScale = 1 + progress*0.01` (85–89, 208–213). Settings (General → "Gesture control", Beta): `enableGestures`, `closeGestureEnabled`, `gestureSensitivity` (100/200/300 = High/Medium/Low). The footer says they are mainly for when "Open notch on hover" is off. "Change media with horizontal gestures" is a disabled placeholder.

**Linux fit:** Fits. Two-finger touchpad scrolls reach the actor under the pointer as `Clutter.ScrollDirection.SMOOTH` events with `get_scroll_source() === Clutter.ScrollSource.FINGER`, `get_scroll_delta()` and `get_scroll_finish_flags()` (as used in `ui/swipeTracker.js` 259–287; methods in `Clutter-18.gir`). Three- and four-finger swipes belong to GNOME, so stay with two-finger scrolls. Do **not** use `SwipeTracker`, because it also installs a global 3-finger touchpad gesture that would fight the workspace gestures. Touchscreen: `Clutter.PanGesture` (`pan-axis` Y, `get_accumulated_delta`; class confirmed in `Clutter-18.gir`).

**Implementation:**
1. `src/island.js` `this.connect('scroll-event', (a, e) => this._onScroll(e))`:
   - Closed + SMOOTH + FINGER: accumulate `dy`, inverted if `org.gnome.desktop.peripherals.touchpad natural-scroll` is true, so that "fingers move down" always means open.
   - Show progress by adding `min(acc, threshold) / threshold * GESTURE_GROWTH` (about 10 px) to the height spring target, as the visual feedback.
   - When past `threshold` (sensitivity 100/200/300 mapped to about 10/20/30 delta units, since Clutter deltas are about 10 px per unit per `SCROLL_MULTIPLIER`), call `open()`. Reset on the finish flag.
   - Open + upward: close, but only when the event arrives at the island unhandled (St.ScrollViews in the Today tab stop it, matching boring.notch's `!vm.isHoveringCalendar`).
   - Discrete mouse-wheel DOWN on the closed notch: open (optional, under the same switch).
2. Touch: `const pan = new Clutter.PanGesture({pan_axis: Clutter.PanAxis.Y}); pan.connect('pan-update', …); this.add_action(pan)`.
3. Schema `enable-gestures` (b, true), `close-gesture` (b, true), `gesture-sensitivity` (i 1–3, 2). Prefs group "Gestures" in General.

**Testing:** Virtual pointer `notify_scroll_continuous(time, 0, 25, Clutter.ScrollSource.FINGER, Clutter.ScrollFinishFlags.NONE)` over the island, then assert `_state === 'open'`. Repeat with natural scrolling on and off.

**Risks:** Scrolls are also used by the volume-on-scroll habit some users have on the top bar. Only the island area is affected. No idle cost.

**Effort / value:** S. Medium–High (touchpad users expect it).

### 7.2 Keyboard shortcuts: toggle the notch, toggle the music sneak peek

**boring.notch:** `Shortcuts/ShortcutConstants.swift` (`toggleNotchOpen` Cmd+Shift+I, `toggleSneakPeek` Cmd+Shift+H; `clipboardHistoryPanel`, `toggleMicrophone` and the backlight shortcuts are declared but unused). Handlers in `boringNotchApp.swift`: toggle open picks the screen under the mouse and auto-closes after 3 s if opened by keyboard. The Shortcuts pane uses KeyboardShortcuts.Recorder.

**Linux fit:** Fits. `Main.wm.addKeybinding(name, settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT, Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, handler)` and `Main.wm.removeKeybinding(name)` (`ui/windowManager.js` 746–758, 1085).

**Implementation:**
1. Schema: `toggle-notch` (as, `['<Super><Shift>i']` after checking it is free in GNOME 50 with `gsettings list-recursively | grep -i "<super><shift>i"`), `toggle-sneak-peek` (as, `[]`).
2. `extension.js`: add the bindings in `enable()` and remove them in `disable()`. Toggle: `island.toggle(island.tab)`. If opened by keyboard, schedule close after 3 s unless hovered (`Island.openTemporarily(3000)`).
3. Keyboard navigation once open: `global.stage.set_key_focus(firstButton)` and close on Escape (`key-press-event`). boring.notch has neither, but it costs little and helps accessibility.
4. Prefs: a "Shortcuts" group with a custom `ShortcutRow` (`Adw.ActionRow` + `Gtk.ShortcutLabel`; clicking opens a small `Adw.Dialog` with `Gtk.EventControllerKey` that builds `Gtk.accelerator_name_with_keycode`; Backspace clears, Escape cancels). This is the usual extension pattern, since libadwaita has no shortcut recorder.

**Testing:** `Main.wm._findAction`/Eval-trigger via `global.display.get_keybinding_action`. Simpler: call the handler directly through Eval and check `Meta.KeyBindingAction`. A real-key test needs a virtual keyboard device (`notify_keyval`).

**Risks:** Conflicts with user bindings; the defaults must be free. Cleanup: `removeKeybinding` in disable (this is required, or the binding leaks).

**Effort / value:** S. High (keyboard users have no way in without hover).

### 7.3 Right-click menu and an option to hide the gear

**boring.notch:** `.contextMenu { Button("Settings") }` on the notch (`ContentView.swift` 185–197) and `settingsIconInNotch` (`BoringHeader.swift` 59–75).

**Implementation:** In `Island`'s `button-press-event`, on button 3 show a `PopupMenu.PopupMenu` anchored to the island with "Settings", "Open Today", "Open Shelf" and "Hide notch for 1 hour" (a Linux-only extra, optional). Schema `show-settings-button` (b, true) → `Header` hides the gear.

**Effort / value:** S. Low–Medium.

### 7.4 Remember the last tab / always show tabs

**boring.notch:** `openLastTabByDefault` ("Remember last tab", default off) and `alwaysShowTabs` (`BoringViewCoordinator.swift` 62–80, `BoringViewModel.close()`). By default the notch goes back to Home on close (or to Shelf if it has items).

**Linux fit:** The port currently *always* remembers the last tab (`open(tab = this._tab)`), so the setting is the gap.

**Implementation:** Schema `remember-last-tab` (b, false). In `Island.close()`, set `this._tab = 'home'` (or `'shelf'` per 5.1) unless the setting is on. Leave "always show tabs" out: the port has three or four tabs and always needs them.

**Effort / value:** S. Low.

---

## 8. Appearance

### 8.1 Drop shadow when open or hovered, and corner-radius scaling

**boring.notch:** `ContentView.swift` 111–114 (black at 0.7 opacity, radius 6, only when open or hovered, `enableShadow`), and `cornerRadiusScaling` (46–59: open radii 19/24 vs the closed radii).

**Linux fit:** The island uses `clip_to_allocation: true`, so a shadow cannot be drawn by the island itself. Use a sibling actor: an `St.Widget` with `background-color: black; border-radius: 0 0 Rpx Rpx; box-shadow: 0 2px 12px rgba(0,0,0,.7)` added with `Main.layoutManager.addTopChrome(shadow)` *below* the island and kept `reactive: false` so it never takes clicks (GNOME 50 removed the `affectsInputRegion` option), with its geometry set in `_applyGeometry()`. St draws box-shadow outside the allocation.

**Implementation:** `src/island.js` creates `this._shadow` and updates its geometry in `_applyGeometry` (it follows the springs). Fade its opacity on open and hover. Schema `shadow` (b, true), `open-corner-radius` (b, true; off = keep the closed radii when open).

**Risks:** St regenerates the shadow texture on every size change, which costs extra during open and close animations only. Measure it. Cleanup: `removeChrome` and destroy in `disable()` (via the island's destroy).

**Effort / value:** S–M. Low–Medium.

### 8.2 Accent colour (system or custom)

**boring.notch:** Advanced pane "Accent color": System, or Custom with 8 presets and a colour picker (`useCustomAccentColor`, `customAccentColorData`, `extensions/Color+AccentColor.swift`). It tints toggles, sliders and HUD bars.

**Linux fit:** Fits. GNOME 47+ accent colour: `St.Settings.get()` `notify::accent-color` (`ui/status/darkMode.js` 24), and the CSS value `-st-accent-color` (`ui/padOsd.js` 20; `accent-color` confirmed in `St-18.typelib`).

**Implementation:** In `src/style.css`, use `-st-accent-color` for `.bn-toggle:checked`, the slider fill and `.bn-chip:checked`, which follows the system for free. Custom: schema `accent-mode` (s: `system|custom`), `custom-accent` (s, `#3584e4`). When custom, set inline styles on the few accent elements, or append a rule to the generated stylesheet in `src/style.js` (that file already rewrites `style.css`, so it can substitute `-st-accent-color` → `#hex`). Prefs: `Adw.ComboRow` + `Gtk.ColorDialogButton` + preset `Gtk.ToggleButton`s.

**Effort / value:** S. Low–Medium.

### 8.3 Idle face animation ("Show cool face animation while inactive")

**boring.notch:** `components/AnimatedFace.swift` `MinimalFaceFeatures` (two eyes that blink every 3 s, and a mouth), shown when nothing plays (`ContentView.swift` 293–294, 367–386, `showNotHumanFace`).

**Implementation:** `FaceView extends ClosedView` (`sideWidth = notchHeight + 2`, eyes on the right as two `St.Widget` dots). Blink with one `GLib.timeout_add_seconds(3, …)` that eases `scale_y` of the eyes to 0.1 and back. `_currentClosedView` falls back to it when there is no other view and `show-face` is set.

**Risks:** It breaks the "nothing runs while idle" rule (one wake-up and two short redraws every 3 s). Keep it opt-in and off, and say so in prefs.

**Effort / value:** S. Low (charming, but niche).

---

## 9. Displays, sizing, first run, settings layout

### 9.1 Multiple displays: show on all displays, preferred display, follow focus

**boring.notch:** `showOnAllDisplays`, a "Preferred display" picker (`preferredScreenUUID`), and `automaticallySwitchDisplay` (General → System features). `AppDelegate` keeps a window and view model per screen UUID (`boringNotchApp.swift` `windows`, `viewModels`, `screenConfigurationDidChange`). The toggle-open shortcut picks the screen under the mouse.

**Linux fit:** Fits. Today `Island` hard-codes `Main.layoutManager.primaryIndex` and `primaryMonitor` (`island.js` `monitorIndex`, `_applyGeometry`). Monitor identity is the connector: `global.backend.get_monitor_manager().get_monitor_for_connector(connector)` → index (used in `ui/osdMonitorLabeler.js` 101 and `ui/shellDBus.js` 148). In prefs: `Gdk.Display.get_default().get_monitors()` → `Gdk.Monitor.connector`/`description`. Follow focus: `global.display` `notify::focus-window` → `window.get_monitor()`.

**Implementation:**
1. Refactor: `Island` takes `monitorIndex` as a property. `_applyGeometry` uses `Main.layoutManager.monitors[this._monitorIndex]`, and `_notchHeight` uses that monitor's panel height (only the primary has a GNOME panel, so other monitors use `closed-height` from 9.2 or the primary's panel height).
2. New `src/notchManager.js` owns the islands:
   - `primary` / `preferred` / `follow-focus`: one island, moved by setting `monitorIndex` + `_relayout(true)`.
   - `all`: one island per monitor. Each heavy part must exist **once**: share a single `OpenView` and reparent it into whichever island opens (`island.adoptOpenView(view)`; only one can be open at a time). This matters because `CalendarMessageList` and `Calendar.Calendar` are heavy GNOME widgets.
3. `extension.js`: the OSD override routes `monitorIndex` → the island on that monitor (`notchManager.islandFor(monitorIndex)`). Notification peeks go to the island on the monitor with the pointer (`global.get_pointer()` → `global.display.get_monitor_index_for_rect`). `toggleCalendar` and the shortcut work the same way.
4. Schema `display-mode` (s: `primary|preferred|follow-focus|all`, `primary`), `preferred-monitor` (s connector, ''). Prefs ComboRows.

**Testing:** `gnome-shell --headless --virtual-monitor 1920x1080 --virtual-monitor 1280x720`. Assert island positions through Eval for each mode, and fire an OSD on monitor 1.

**Risks:** The `'all'` mode multiplies the closed layers and springs, which cost little idle, but the clock label and visualizer per island do add up. Run the visualizer only on the island that shows media (for example, the primary). Hot-plug: rebuild on `monitors-changed` (already connected). Cleanup: destroy every island and remove its chrome.

**Effort / value:** M (single moving island), L (all displays). Medium for multi-monitor users, Low for everyone else.

### 9.2 Notch height setting

**boring.notch:** `notchHeightMode` / `nonNotchHeightMode` (match the real notch / match the menu bar / custom 15–45 or 0–40), in `sizing/matters.swift` `getClosedNotchSize`.

**Implementation:** Schema `closed-height-mode` (s: `panel|custom`), `closed-height` (i 16–48, 32). `Island._notchHeight` returns the custom value when set. A custom height taller than the panel overlaps windows, which is fine for chrome.

**Effort / value:** S. Low.

### 9.3 Settings split into categories, plus an About page

**boring.notch:** A sidebar with General, Appearance, Media, Calendar, HUDs, Battery, Shelf, Shortcuts, Advanced, About (`SettingsView.swift` 27–127). About shows the version and release name, a GitHub link and Sparkle updates (`About`, 835–910).

**Linux fit:** `Adw.PreferencesWindow` already shows pages as a view switcher. The port has one "General" page.

**Implementation:** Split `prefs.js` into `prefs/general.js`, `appearance.js`, `media.js`, `calendar.js`, `hud.js`, `battery.js`, `shelf.js`, `shortcuts.js` and `about.js`. Each exports `buildPage(settings)` and is listed in `fillPreferencesWindow`. Add each to the Makefile's `--extra-source`. About: an `Adw.PreferencesPage` with the version from `this.metadata['version-name']`, the repo link and the GPL notice. Leave updates out (extensions.gnome.org handles them). Do this **first**, because nearly every feature above adds rows.

**Effort / value:** S. Medium (the settings stay findable as they grow).

### 9.4 First-run "hello" animation and welcome sound

**boring.notch:** `animations/HelloAnimation.swift`: the notch opens on first launch, and a glowing "hello" stroke (path data in `HelloShape.path`) draws itself over 4 s after a 0.6 s wait, then closes (`BoringViewCoordinator.helloAnimationRunning = firstLaunch`, `ContentView.swift` 249–258). `AppDelegate.playWelcomeSound()` plays `boring.m4a`.

**Linux fit:** Fits. Cairo in `St.DrawingArea` can stroke a partial path: compute the arc length of the polyline from the copied `HelloShape` points, and use `cr.setDash([len*progress, len], 0)`. Approximate the glow with 3 strokes at decreasing width and alpha. Sound: `global.display.get_sound_player().play_from_file(file, 'Welcome', null)` (`play_from_file` confirmed in `Meta-18.gir` 11423; the port already uses `play_from_theme`).

**Implementation:** `src/hello.js` `HelloView`. In `Island`, if `!settings.get_boolean('hello-shown')`, then 1 s after enable, open with a custom size (the closed width × 80 px), run the 4 s animation with one `GLib.timeout_add` per frame or `Clutter.Timeline`, close, and set `hello-shown = true`. A "Replay welcome" button in About. Asset: copy `boring.m4a` only if its licence allows (the repo is GPL-3.0; check the asset's origin). Otherwise use `play_from_theme('complete')`.

**Risks:** It runs once, so cost is negligible. Do not run it on every `enable()`: GNOME re-enables extensions after every unlock, and the GSettings flag handles that.

**Effort / value:** S–M. Low–Medium (a nice first impression).

### 9.5 Show on the lock screen

**boring.notch:** `showOnLockScreen` (Advanced) uses the SkyLight private API to keep the window above the lock screen (`components/Notch/BoringNotchSkyLightWindow.swift`, `AppDelegate.onScreenLocked`).

**Linux fit:** Possible. Add `"session-modes": ["user", "unlock-dialog"]` to `metadata.json`, then on `Main.sessionMode` `'updated'` with `isLocked` (`ui/sessionMode.js` 72–73): close the island, disable tabs (no Today tab: it would expose notifications on the lock screen; GNOME's own lock-screen notification policy must apply), and show only the clock and media live activity. Check that the island stacks above `Main.layoutManager.screenShieldGroup` (`ui/layout.js` 270–280) **(verify)**.

**Risks:** Extension review requires a justification for `unlock-dialog` and strict behaviour on lock (no keyboard grabs, no private data). Today the extension is simply disabled on lock, which is the safe default.

**Effort / value:** M. Low. **Defer.**

### 9.6 Top-bar indicator menu (boring.notch's menu-bar icon)

**boring.notch:** `menubarIcon` and `MenuBarExtra` with Settings / Check for updates / Restart / Quit (`boringNotchApp.swift`, `menu/StatusBarMenu.swift`).

**Linux fit:** The notch *is* in the top bar, and the gear and right-click menu (7.3) cover Settings. Quit and Restart map to the Extensions app. Offer it only if users ask: `PanelMenu.Button` with "Settings" and "Disable".

**Effort / value:** S. Low. **Skip by default.**

---

## 10. Small leftovers

| boring.notch setting | Status | Plan |
|---|---|---|
| `minimumHoverDuration`, `openNotchOnHover` | Already in the port (`hover-delay`, `open-on-hover`) | — |
| boring.notch forces `enableGestures` on when hover is off (`GeneralSettings.onChange`) | Gap | After 7.1, in prefs, turning off hover turns gestures on |
| `selectedDownloadIndicatorStyle`, `selectedDownloadIconStyle` (Downloads pane is commented out in `SettingsView.swift` 385–463) | Gap, low | Optional: show the browser's icon on the download live activity (`.part` → Firefox, `.crdownload` → the Chromium family, via `Shell.AppSystem` lookup). Progress percent is not knowable from the folder alone. S, Low |
| `waitInterval` | See 1.7 | — |
| `showShuffleAndRepeat` (legacy) | Covered by 1.2 slots | — |
| `enableLyrics` | See 1.5 | — |
| `showEmojis`, `tileShowLabels`, `extendHoverArea`, `clipboardHistoryPanel`, `toggleMicrophone`, `decreaseBacklight`, `increaseBacklight`, `enableDownloadListener`, `enableSafariDownloads`, `useMusicVisualizer` (toggle disabled), `customVisualizers`/`selectedVisualizer` | Declared but not used, or disabled, in the Swift code (checked with grep outside Constants/SettingsView) | Nothing to port |
| `hideTitleBar` → `chinHeight` (an invisible hover strip under a short notch) | macOS window detail | The port's island is the full top bar height, so nothing is needed |
| `releaseName`, What's New window (`components/WhatsNewView.swift`), TipKit tips (`components/Tips/TipStore.swift`) | Placeholder content in boring.notch | Optional: an "Updated to vX" peek once per version (compare `metadata['version-name']` with a `last-seen-version` key). S, Low |

---

## 11. Not proposed (does not make sense on GNOME, or not feasible)

| boring.notch feature | Why not | Closest alternative |
|---|---|---|
| Custom Lottie visualizers (`components/LottieView.swift`, `components/Music/LottieAnimationView.swift`, `customVisualizers`) | No Lottie renderer for GJS/St (no rlottie GI binding), and boring.notch itself marks it "Coming soon" with the toggle disabled | Add Cairo/St visualizer styles (bars, wave, dots) behind a `visualizer-style` key if users ask |
| Haptic feedback (`enableHaptics`, `.sensoryFeedback`) | No Force Touch haptics API on Linux | None. A subtle sound is possible but would be annoying |
| Hide from screen recording (`hideFromScreenRecording`, `BoringNotchSkyLightWindow`) | No public Mutter/Shell API to leave a shell actor out of screencasts or screenshots | None |
| Option-key media-key actions (`optionKeyAction`, `observers/MediaKeyInterceptor.swift`) and its accessibility-permission flow | gsd-media-keys owns the media keys, and taking them over needs a grab that conflicts with GNOME's own volume handling | Possible later: `Main.wm.addKeybinding` for `<Alt>XF86AudioRaiseVolume` → open Sound settings, only if it is not already bound. Low value |
| Image actions: Remove Background (Vision), HEIC conversion, Create PDF (`components/Shelf/Services/ImageProcessingService.swift`) | Background removal needs an ML model (out of scope for a shell extension). PDF and HEIC need extra tools | Shelf "Open With" covers it; convert PNG↔JPEG could use `GdkPixbuf.savev` later |
| Favourite/like button for Apple Music and YouTube Music (`MusicControlButton.favorite`, `MediaControllers/*`) | MPRIS has no like method | Hide the slot |
| Onboarding permission steps (camera, calendar, reminders, accessibility, music controller; `components/Onboarding/*`) | GNOME has no per-app permission prompts for a shell extension. The camera and calendar are reachable without prompts | First-run hello (9.4) plus clear prefs subtitles |
| Launch at login, Sparkle updates, Quit/Restart (`LaunchAtLogin`, `SoftwareUpdater.swift`, `ApplicationRelauncher.swift`) | The extension manager and extensions.gnome.org handle these | — |
| Per-Space window handling (`managers/NotchSpaceManager.swift`, `private/CGSSpace.swift`) | macOS Spaces internals. Top chrome already shows on all workspaces | — |

---

## 12. Prioritised roadmap

### Value vs effort

| # | Feature | Effort | Value | Idle cost added | Main risk |
|---|---|---|---|---|---|
| 9.3 | Settings pages + About | S | Medium | none | — |
| 7.2 | Keyboard shortcuts (toggle notch, sneak peek) | S | **High** | none | key conflicts |
| 1.1 | Music sneak peek (standard / inline) | S | **High** | none | chatty players |
| 7.1 | Two-finger swipe open/close, touch pan | S | Med–High | none | natural-scroll direction |
| 1.2 | Control slots (+volume, ±15 s) | S–M | Medium | none | players without `Volume` |
| 1.7 | Linger timeout + media activity switch | S | Low–Med | none | — |
| 2.3 | HUD in the open notch + percentage switches | S | Medium | none | — |
| 7.3 | Right-click menu + hide-gear | S | Low–Med | none | — |
| 7.4 | Remember last tab | S | Low | none | — |
| 3.2 | Battery display options + colours | S | Low–Med | none | — |
| 1.3 | Album-colour tinting (bars, text, slider) | S–M | Medium | none | async decode |
| 1.4 | Art glow, paused dimming, app badge/fallback | S | Medium | none | blur cost (cached) |
| 1.6 | Marquee titles | S | Medium | none | redraw while scrolling (capped) |
| 4.1 | Calendar colours, hide all-day, full titles, auto-scroll, dim past, click to open | M | Medium | file monitor | EDS key-file format |
| 8.2 | Accent colour | S | Low–Med | none | — |
| 2.1 | Row-style HUD | S | Low–Med | none | — |
| 2.2 | Draggable HUD bar | M | Medium | none | private volume module, OSD recursion |
| 3.1 | Battery popover | M | Medium | D-Bus subs | polkit for power profile |
| 3.3 | Power-saver peek | S | Low | D-Bus sub | — |
| 1.8 | Fullscreen behaviour modes | S–M | Low–Med | signal | click-stealing over fullscreen |
| 1.9 | Preferred / ignored players | S | Low–Med | none | — |
| 8.1 | Shadow + corner-radius toggle | S–M | Low–Med | none | shadow regen during animation |
| 5.1 | **Shelf phase A** (tab, paste, downloads/screenshots, menu, Sushi preview) | M | **High** | none | — |
| 5.2 | **Shelf phase B** (drag onto notch, helper client) | L | **High** | helper only after a drag | Wayland stacking/focus fragility |
| 5.4 | Quick Share (GSConnect / Bluetooth / LocalSend / email) | S–M | Medium | none | GSConnect API (verify) |
| 1.5 | Lyrics (LRCLIB, synced) | M | Medium | none | privacy (opt-in) |
| 6 | Webcam mirror | M | Medium | none (gst only while shown) | privacy, camera busy |
| 9.1 | Multi-display (preferred / follow-focus → all) | M → L | Medium (multi-monitor) | small per island | OpenView sharing |
| 4.2 | Calendar selection | S–M | Low–Med | none | private `EventSourceBase` |
| 4.4 | "Up next" on Home | S–M | Low–Med | none | — |
| 9.4 | Hello animation + welcome sound | S–M | Low–Med | none (once) | asset licence |
| 9.2 | Custom notch height | S | Low | none | — |
| 8.3 | Idle face | S | Low | 1 wake-up / 3 s (opt-in) | breaks the idle rule |
| 4.3 | Tasks/reminders via EDS | L | Low–Med | ClientView sub | optional typelib dependency |
| 5.3 | Shelf drag-out | L | Low–Med | helper | duplicated UI |
| 9.5 | Lock-screen notch | M | Low | — | review rules, privacy |
| 9.6 | Top-bar indicator menu | S | Low | none | — |

### Recommended order

1. **Release 1.1, the core interactions (about 1 week):** 9.3 settings pages → 7.2 shortcuts → 1.1 music sneak peek → 7.1 gestures → 1.2 control slots → 1.7 linger and media switch → 2.3 open-notch HUD → 7.3 context menu → 7.4 remember tab → 3.2 battery options. All S, all zero idle cost, and they cover the most noticeable gaps (keyboard access, track-change peeks, gestures).
2. **Release 1.2, the boring.notch look (about 1 week):** 1.3 album colour → 1.4 art glow, badge, paused state → 1.6 marquee → 8.2 accent → 2.1 row HUD → 2.2 draggable HUD → 8.1 shadow. Measure CPU after each (open + playing must stay near today's 1.0%).
3. **Release 1.3, the Shelf (2–3 weeks):** 5.1 phase A first (useful without DnD and fully testable headless), then 5.2 phase B behind a switch, then 5.4 Quick Share. Write the manual DnD test checklist and test on a real Wayland session before turning phase B on by default.
4. **Release 1.4, information (about 1–2 weeks):** 4.1 calendar options → 3.1 battery popover + 3.3 power-saver peek → 1.5 lyrics (opt-in) → 1.8 fullscreen modes → 1.9 player preference → 4.2 calendar selection → 4.4 "Up next".
5. **Release 1.5, extras:** 6 webcam mirror → 9.1 multi-display (moving island first, all displays later) → 9.4 hello animation → 9.2 height → 8.3 face.
6. **Backlog / on request:** 4.3 EDS tasks, 5.3 drag-out, 9.5 lock screen, 9.6 indicator, 2.4 gradient/glow, visualizer styles.

Why this order: the first two releases are cheap, keep the zero-idle-cost promise, and change how the notch *feels* every day. The Shelf is the highest-value item but carries the only serious platform risk (Wayland DnD through a helper client), so it comes once the settings structure and interaction model are settled, in a phase that works without DnD. Camera, lyrics and multi-display are worthwhile but either opt-in for privacy or relevant to a subset of users.

---

## Appendix A: new GSettings keys, by prefs page

- **General:** `toggle-notch` (as), `toggle-sneak-peek` (as), `enable-gestures` (b), `close-gesture` (b), `gesture-sensitivity` (i), `remember-last-tab` (b), `display-mode` (s), `preferred-monitor` (s), `closed-height-mode` (s), `closed-height` (i), `hello-shown` (b)
- **Appearance:** `show-settings-button` (b), `shadow` (b), `open-corner-radius` (b), `accent-mode` (s), `custom-accent` (s), `album-art-glow` (b), `colored-visualizer` (b), `player-tinting` (b), `slider-color` (s), `show-mirror` (b), `mirror-shape` (s), `show-face` (b)
- **Media:** `show-media-activity` (b), `media-linger-seconds` (i), `enable-sneak-peek` (b), `sneak-peek-style` (s), `fullscreen-behavior` (s), `music-controls` (as), `show-lyrics` (b), `preferred-player` (s), `ignored-players` (as)
- **HUD:** `hud-style` (s), `show-open-hud` (b), `hud-percentage-open` (b), `hud-percentage-closed` (b), `hud-accent` (b)
- **Battery:** `show-battery-indicator` (b), `show-battery-percentage` (b), `show-power-icons` (b)
- **Calendar:** `hide-all-day-events` (b), `full-event-titles` (b), `auto-scroll-next-event` (b), `hidden-calendars` (as), `home-calendar` (b), `show-tasks` (b), `hide-completed-tasks` (b)
- **Shelf:** `enable-shelf` (b), `open-shelf-by-default` (b), `shelf-add-downloads` (b), `shelf-add-screenshots` (b), `expanded-drag-detection` (b), `enable-shelf-drop` (b), `quick-share-provider` (s)

## Appendix B: APIs confirmed in this environment

| API | Where confirmed |
|---|---|
| `Main.wm.addKeybinding` / `removeKeybinding` | `ui/windowManager.js` 746–758, 1085 |
| `global.backend.get_dnd()` signals `dnd-enter`/`dnd-position-change`/`dnd-leave`; `Main.xdndHandler` `drag-begin`/`drag-end` | `ui/xdndHandler.js`, `Meta-18.gir` 4743–4765, `ui/messageTray.js` 789 |
| `Meta.WaylandClient.new_subprocess`, `owns_window`, `get_subprocess`; `Meta.Window.move_frame`, `make_above`, `stick`, `hide_from_window_list`, `set_type` | `Meta-18.gir` 12094–12188, 13781, 14150–14502 |
| `global.display` `in-fullscreen-changed`, `get_monitor_in_fullscreen` | `ui/layout.js` 168, 342, 987–994 |
| Monitor by connector: `get_monitor_manager().get_monitor_for_connector` | `ui/osdMonitorLabeler.js` 101, `ui/shellDBus.js` 148 |
| `St.ImageContent.new_with_preferred_size` + `set_bytes(coglContext, …)` | `ui/screenshot.js` 2335–2346, `ui/qrCode.js` 91–103 |
| `Shell.BlurEffect`, `Shell.CameraMonitor` (`cameras-in-use`) | `ui/unlockDialog.js` 732, `ui/status/camera.js`, `Shell-18.typelib` |
| `St.Clipboard.get_content` / `set_content` / `get_mimetypes` | `St-18.typelib` |
| `St.Settings` `accent-color`, CSS `-st-accent-color` | `ui/status/darkMode.js` 24, `ui/padOsd.js` 20, `St-18.typelib` |
| `getMixerControl()` (volume), `Main.brightnessManager.globalScale.value` | `ui/status/volume.js` 22, `misc/brightnessManager.js` 100, 279–330, `ui/main.js` 278 |
| `Calendar.EventSourceBase`, `DBusEventSource` event shape and id prefix | `ui/calendar.js` 79–91, 305–343 |
| Clutter scroll `get_scroll_source`/`get_scroll_finish_flags`, `Clutter.PanGesture`, virtual device `notify_scroll_continuous`/`notify_discrete_scroll`/`notify_touch_down` | `Clutter-18.gir` 21622, 21668, 49235, 62212–62333 |
| `Meta.SoundPlayer.play_from_file` | `Meta-18.gir` 11423 |
| Sushi `org.gnome.NautilusPreviewer2.ShowFile(s,s,b,s)` | `gdbus introspect` on this machine |
| UPower `Capacity`, `TimeToFull`/`TimeToEmpty`, `ChargeThresholdEnabled`; PowerProfiles `ActiveProfile` (rw) | `gdbus introspect` / `upower -d` on this machine |
| `gnome-calendar --uuid`, `--date` | `gnome-calendar --help` |
| GStreamer `pipewiresrc`, `v4l2src`, `appsink` | `gst-inspect-1.0` |
| **Not available:** ECal / EDataServer typelibs | not in `/usr/lib/x86_64-linux-gnu/girepository-1.0` |
