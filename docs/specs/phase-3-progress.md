# Phase 3 progress

Branch `phase-3-cleanup-and-look`. Nothing pushed.

| Item | State | Notes |
|---|---|---|
| A1–A11 | done | 11 commits through `7f7a9a4` |
| B1 recording activity | done | `41ac71a` |
| B2 sound-output peek | done | `38498db` |
| C1 art colours | done | `b15e5a8` |
| C2 art glow + paused state | done | `dacf176`; CPU measured, no rise from the blur |
| review fixes | done | `4367dc2`, `6bf7a58`, `dd30848` |
| player-null crash guard | done | `daac177` — kill-mid-download clean, guarded call shapes don't throw |
| C3 scrolling titles | done | `1cc8f4d` MarqueeLabel, two passes, verified in open player + peek |
| C4 accent colour | done | see below |
| C5 row-style HUD peek | done | `7122479`; see below |
| C6 draggable HUD bar | done | see below |
| Today tab multi-event test | todo | 100% and 125% |
| 125% sweep, evidence, report | todo | |

## C4 notes

- Schema: `accent-mode` (s: off/system/custom, off default), `custom-accent`
  (s, `#3584e4`). Prefs: a Colour group on General with a dropdown and a
  `Gtk.ColorDialogButton` only visible for custom, stored as `#rrggbb`.
- Loader (`src/style.js`): the template's `@accent`, `@accent-chip` and
  `@accent-chip-text` tokens are substituted before the px scaling; `off`
  falls back to the old colours (white bars, orange chip with black text).
  System mode substitutes `-st-accent-color` and `-st-accent-fg-color`;
  custom mode substitutes the hex and picks black or white chip text by
  brightness. Reload on accent-mode/custom-accent changes and on St
  `notify::accent-color`; the reload key includes the accent so repeated
  loads at the same zoom still happen.
- Barlevel verification: `-st-accent-color` **does** work as a
  `-barlevel-active-background-color` — a probe widget resolves it via
  `lookup_color` (kept the numbers: system red → 216,43,72; custom blue →
  53,132,228), so no JS bar colouring was needed.
- Live checks: chips and bars recolour at once in all three modes without
  restarting; the system accent follows `gsettings set
  org.gnome.desktop.interface accent-color ...` while the notch is open;
  off restores white bars. Idle CPU the same on and off (1.0–1.3 both).
- The checked tab's pill and `.bn-tab` are untouched (spec lists only the
  four spots). With album-art colouring on, the art tint still wins on the
  bars, as before.

## C5 notes

- `RowHudView` (`src/closedViews.js`): a `ClosedView` whose content hugs
  the bottom of a 28-design-px growth under the clock (`showsClock` stays
  true), icon at the left, a 220-design-px bar and the percentage at the
  right. The same percentage/label logic as the inline style.
- Schema `hud-style` (s: inline/row, inline default) and `hud-percentage`
  (b, true, hides the number in both styles); rows on the Peeks page after
  `Volume and brightness while open`, also gated on `replace-osd`.
- `Island.showHud` picks the view per event from `hud-style`; switching
  the setting changes the next peek. The peek is still one `hud` row per
  level: repeated presses reported `queued: 1` and the bar updated in
  place.
- Idle CPU identical between the styles (0.0–0.7 both); the growth rides
  the existing height spring.

## C6 notes

- Both styles now sit on one registered `HudView` base in
  `src/closedViews.js`; the bar is a `Slider.Slider` (which is a `BarLevel`),
  so it keeps the look and can be dragged or scrolled. The slider's own
  `.slider` theme class is removed so the HUD bar has no handle.
- `hudKind()` reads the OSD icon: `audio-volume*` is volume,
  `display-brightness*` is screen brightness, everything else (keyboard
  backlight, microphone) leaves the bar `reactive: false`.
- `Island._adjustHud` writes the level and returns what it came to, so the
  percentage follows the drag: the default sink with `push_volume()` and
  the above-100 clamp from `_changeVolume`; `Main.brightnessManager
  .globalScale.value` for brightness, `null` (read-only) without a
  backlight. A drag produced **no** new peek in ten writes, so there is no
  OSD loop.
- The peek re-arms its timeout while `HudView.isInUse()` (dragging or the
  pointer on the bar) instead of ending under the hand.
- A press whose source is the bar returns `EVENT_PROPAGATE` from
  `_onButtonPress`, so it never opens the notch or runs the peek action.
- Checks at 100% and 125%: inline and row both drag (0.45 → 70 → 66 with
  two scroll steps, label follows), amplified volume reaches 1.5 with the
  setting on and clamps to 1.0 with it off, fast mute is cleared on a drag,
  no JS errors, smoke passes. The headless box has no backlight, so the
  brightness write itself was not exercised; the null path returns `null`
  and leaves the bar inert.
