# Spec: the notch is blurry at 100% scale on an external monitor

Branch to work on: `fix-sharpness-100` (create it from `phase-3-cleanup-and-look`).
Do not push. Do not touch `main`, `phase-4-extras`, `phase-4-info`.

## The problem

The author reports: on an external monitor at 100% display scale the quality of
the notch "drops significantly" compared with the laptop screen at 125%
(where text and icons are crisp). Text, icons and edges look soft.

Facts about the author's real session (read-only, from Mutter's
`GetCurrentState`; check them again yourself, see step 1):

- One logical monitor is active: `HDMI-1`, 2560x1440 @ 144 Hz, **scale 1.0**,
  primary. The built-in `eDP-1` is not in the current layout.
- `gsettings get org.gnome.mutter experimental-features` is
  `['scale-monitor-framebuffer', 'xwayland-native-scaling']`.
- The extension's `text-size` default is 1.25 and `size` is 1.0, so CSS lengths
  are multiplied by 1.0 (layout) and fonts by 1.25 (text).
- GNOME Shell 50, Wayland, Ubuntu 26.04.

So this is not (only) a mixed-scale problem. It happens with a single monitor at
integer scale 1. At 125% earlier work already made everything snap to device
pixels (see "What was already done").

## What was already done (do not redo)

- `src/style.js` rewrites `src/style.css` so every `px` length is multiplied by
  the zoom, rounded to whole pixels; icon sizes snap to 12/16/24/32/48/64.
- `src/island.js` has `_deviceScale` (max of the stage views' scale) and
  `_snap(value)` (round to whole device pixels). `_applyGeometry()` snaps the
  notch width, height and centre. `src/notchShape.js` draws only the two small
  flared corners with Cairo; the body is a CSS background.
- Content is kept at a fixed size and moved with `translation_x` /
  `translation_y` (pages parked at `PARKED_Y`); the notch grows around it.
  Closed views are moved with `child.translation_x = half - child._bnHalf`.

## Hypotheses, most likely first

Each one must be confirmed or rejected with a measurement, not assumed.

1. **Fractional offsets from translations.** `_bnHalf` is half of a view's
   width, which can be x.5 logical pixels; `translation_x = half - _bnHalf`
   then lands text and icons between device pixels. At 125% the extension's
   `_snap` does not cover these offsets either; at 100% (a low-DPI display)
   the softness is far more visible. Same question for `translation_y`, the
   spring-driven values after the animation has settled, the clock slot, the
   open view's `_openHalf`, and the `PARKED_Y` pages.
2. **Actors with fractional size or position.** `set_size(2 * half, height)`
   uses snapped values, but children centred inside (`y_align`/`x_align`
   CENTER, `St.BoxLayout` spacing, labels whose natural width is fractional,
   `St.Bin` art) can end up at .5 offsets. Text rendered at a fractional
   position is resampled and looks soft.
3. **Textures rendered for the wrong size or scale.** The two Cairo corners are
   drawn into `St.DrawingArea`s; check their surface size against the stage
   view's scale. The album art (`background-image` with `background-size`), the
   glow (`Shell.BlurEffect`), and `St.Icon` sizes should be checked as well.
4. **Opacity / effect layers forcing offscreen rendering.** Actors with
   `opacity` between 0 and 255, a `BlurEffect`, or `clip_to_allocation` on a
   transformed parent are rendered to an offscreen buffer; if that buffer is
   not pixel aligned the content is resampled. The fade of the closed layer
   (`_fade`) and the glow are suspects.
5. **Font settings, not our code.** If after fixing 1 to 4 the text still looks
   softer than GNOME's own top bar text next to it, compare against GNOME's
   own panel text on the same screen. If they look the same, the rest is
   GNOME's font rendering at 1x and is not ours to fix; say so.
6. **Mixed-scale layouts (separate, secondary).** `_deviceScale` uses the
   largest scale of all stage views, and `_scale` uses the global theme
   context scale. With two monitors of different scales the notch is snapped to
   the wrong grid for the monitor it is on. Fix this too (use the scale of the
   monitor the notch is on: `Main.layoutManager.primaryMonitor` ->
   `global.display.get_monitor_scale(index)`, or the stage view whose layout
   contains the notch), but only after the single-monitor 100% case is fixed
   and measured.

## How to do it

### Step 1: know the setup (read-only)

```
gdbus call --session --dest org.gnome.Mutter.DisplayConfig \
  --object-path /org/gnome/Mutter/DisplayConfig \
  --method org.gnome.Mutter.DisplayConfig.GetCurrentState
gsettings get org.gnome.mutter experimental-features
gsettings get org.gnome.desktop.interface text-scaling-factor
```

Do not change the real session's settings. All tests run in the headless shell.

### Step 2: the headless harness

Read `tools/headless/*.sh` first. Always `export BN_TEST_DIR=/tmp/bn-test-sharp`
(other agents use other folders), run `glib-compile-schemas schemas` in the
worktree, and start a session with `tools/headless/session.sh 2560x1440` for
the author's monitor size at scale 1 (no `--fractional`), and
`session.sh --fractional` for 125%. Wait with `tools/headless/wait.sh`
(prints `state=1`). Drive it with `tools/headless/eval.sh '<js>'` (no await;
`global.bn = Main.layoutManager.uiGroup.get_children().find(a => a.name ===
"boring-notch")`). Screenshots: `tools/headless/shot.sh name [w h]`. Use
`timeout N tail -f /dev/null || true` to wait, not a bare `sleep`.

Test music with `tools/headless/player.sh <cover.png> "Title@Artist"` and
peeks as described in `docs/specs/phase-3-progress.md`. Keep the notch CLOSED
while running `tools/headless/smoke.sh`.

### Step 3: an objective sharpness audit (write this first)

Add `tools/headless/pixels.sh` (or a gjs/python helper called by it) that,
for the notch at rest in each state (closed with nothing, closed with music,
closed with each peek view, open Home, open Today, open Timer), does two things:

a. **Position audit via eval.sh.** Walk the notch's actor tree; for every
   visible `St.Label`, `St.Icon`, `St.Bin`/`AlbumArt` and the notch itself,
   print `get_transformed_position()` and `get_transformed_size()` in stage
   coordinates multiplied by the stage view scale, and flag any value whose
   fractional part is not within 0.01 of an integer (device pixels). Report
   the actor class, text/icon name, the values and the parent chain. This
   directly tests hypotheses 1 and 2. A one-line version that already works
   (it printed nothing for the open Home tab at 100%; check the closed views,
   peeks, Today, Timer and the in-between animation frames too):

   ```
   const out=[]; const walk=a=>{ if(!a.visible) return;
     const [x,y]=a.get_transformed_position(), [w,h]=a.get_transformed_size();
     const f=v=>Math.abs(v-Math.round(v))>0.01;
     if(a.get_stage() && (f(x)||f(y)||f(w)||f(h)) &&
        (a.text!==undefined||a.icon_name!==undefined||a.gicon!==undefined))
       out.push(a.constructor.name+':'+(a.text||a.icon_name||'')+' '+x+','+y);
     a.get_children().forEach(walk); };
   walk(global.bn); out.join(' | ')
   ```

b. **Pixel audit of a screenshot.** Take a screenshot with `shot.sh` (it
   writes PNG in device pixels), and with Python + PIL (`python3 -I`) measure
   edge crispness: for the notch's bottom edge and side edges, count how many
   pixels along a line crossing the edge have an intermediate value (a crisp
   edge between black and the wallpaper has none or one; a resampled one has
   several). Also compare the same text drawn by GNOME's own panel (the clock
   area, a label next to the notch) with the notch's text by the width of the
   glyph stems. Print a number per state so before and after can be compared.

Run both audits at the current tip of the branch (`before`), at 100% and 125%.
Save the output to `docs/specs/sharpness-evidence/before.txt`.

### Step 4: fix what the audit shows

Fix only what the audit proves, smallest change first. Likely fixes:

- Snap translations: compute `half - _bnHalf` and similar offsets in device
  pixels with `_snap`, snap `_bnHalf`/`_openHalf` themselves, and make sure
  the translation of every page and view ends on a whole device pixel when the
  spring has settled (and during the animation round to device pixels per
  frame if the cost is small; measure).
- Give children that are centred an even integer size or align them with a
  fixed offset instead of `CENTER` when the free space can be fractional.
- Make the Cairo corners and any texture use the actual view scale.
- Avoid leaving actors at an intermediate opacity or with an effect at rest;
  remove the effect or the offscreen layer when the animation ends.
- Use the monitor's own scale for `_deviceScale` and the corner scale
  (hypothesis 6).

Do not change the look (sizes, colours, spacing) beyond the sub-pixel shifts
the audit requires, and do not change behaviour.

### Step 5: verify (every commit)

- `tools/headless/smoke.sh` on a FRESH session with the notch closed: all
  checks pass, no `JS ERROR` / `CRITICAL` (in particular no
  `not in the stage` errors; guard code that runs before the island is on
  the stage with `this.get_stage()`).
- The pixel audit after the fix at 100% (2560x1440) and 125%: the number of
  fractionally placed text/icon actors is 0 in every state listed above, and
  the edge crispness number is better or equal. Put the output in
  `docs/specs/sharpness-evidence/after.txt` and before/after crops of the
  same region in the evidence folder (small PNGs, zoomed 4x with nearest
  neighbour so the pixels can be seen).
- Enable, disable, enable: one notch, no errors, handler-call counts equal 2
  (see `smoke.sh`).
- Idle CPU of the headless shell (pid in `$BN_TEST_DIR/shell.pid`, utime+stime
  from `/proc/PID/stat` over 30 s windows, use awk not bc, take two windows
  after the first 30 s of the session) must not rise by more than 0.2
  percentage points.
- If you add a mixed-scale test (hypothesis 6), start `gnome-shell --headless`
  with two `--virtual-monitor` arguments and set different scales through
  `org.gnome.Mutter.DisplayConfig.ApplyMonitorsConfig`, or document why that
  could not be done in the headless shell.

## Lessons from earlier reviews (every one of these happened)

- Read your own diff before committing. Never assume a property exists; check
  against the GNOME Shell 50 sources (extract JS from the shell's gresource:
  `find /usr -name 'libgnome-shell*.so'`, then `gresource list` and
  `gresource extract`) and the `.gir` typelibs.
- Clutter has no `scale` property to ease; use `scale_x` and `scale_y`.
- Do not call `get_theme_node` or place actors before the island is on the
  stage (`this.get_stage()`).
- No dead code, no unused imports, no inconsistent defensive guards. Match the
  surrounding comments, naming and style.
- Test with the notch closed when running `smoke.sh`; peeks do not show while
  it is open.
- Do not report a regression from a single CPU reading taken right after
  start-up or a long test; the first 30 s of a session are noisy.
- Report only what you observed. If something could not be tested (the real
  external monitor, a real mixed-scale setup), say so.

## Deliverables

1. `tools/headless/pixels.sh` (the audit), committed first.
2. The fixes, one commit per cause, each with a message that says what the
   code does and why.
3. `docs/specs/sharpness-report.md`: what was measured before, what each
   hypothesis turned out to be (confirmed, rejected, not testable), what was
   changed, before/after numbers and crops, CPU numbers, what was not tested,
   and anything still soft that is outside the extension's control (hypothesis
   5), with a sentence the author can use to tell GNOME's own text apart from
   ours.
4. Stop your headless session with `tools/headless/stop.sh`.

Commit messages end with a line naming the author of the commit as you
normally do. Never push. Never run `make install` or touch
`~/.local/share/gnome-shell`.
