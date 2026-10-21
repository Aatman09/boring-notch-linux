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
| C5 row-style HUD peek | todo | |
| C6 draggable HUD bar | todo | decide at the end |
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
