# Phase 5: shelf, Quick Share, clipboard history: progress

Branch `phase5-shelf`, from `code-quality`. Work is committed one step at a
time, each after the gate in `docs/specs/next-work-handoff.md`.

## Items

1. **Shelf tab, step 1 (5.1, no drag and drop)**: in progress.
   - Done: `src/shelf.js` (model, paths only, JSON in the cache folder, debounced
     save, prune on open, auto-add of downloads and screenshots), `src/shelfView.js`
     (tab page: Paste, Clear, rows with Open, Show in folder, Remove), header tab
     bound to `show-shelf`, `shelf-auto-add` setting, Shelf prefs page, CSS,
     README line, `tools/headless/shelf.sh`.
   - Test harness: `session.sh` now creates `home/Downloads`, `home/Pictures`
     and `config/user-dirs.dirs` (the watchers need them; without user-dirs GLib
     returned no Downloads folder in the headless shell), and keeps the folders
     named in `BN_KEEP` across a restart.
2. **Quick Share from the shelf (5.4)**: not started.
3. **Clipboard history (F18)**, off by default: not started.

## Notes

- Screenshots: GNOME's screenshot notification carries the image, not the file
  path, so the shelf watches `Pictures/Screenshots` (the English name) for files
  that finish writing.
- The Shelf tab's header label "Today" shows a clipped descender at text size
  1.6. The base branch (`code-quality`) shows the same clip, so it is not from
  this work.
