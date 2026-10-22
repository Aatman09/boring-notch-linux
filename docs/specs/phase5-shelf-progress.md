# Phase 5: shelf, Quick Share, clipboard history: progress

Branch `phase5-shelf`, from `code-quality`. Work is committed one step at a
time, each after the gate in `docs/specs/next-work-handoff.md`.

## Items

1. **Shelf tab, step 1 (5.1, no drag and drop)**: done (commit 0d9c191).
   - Done: `src/shelf.js` (model, paths only, JSON in the cache folder, debounced
     save, prune on open, auto-add of downloads and screenshots), `src/shelfView.js`
     (tab page: Paste, Clear, rows with Open, Show in folder, Remove), header tab
     bound to `show-shelf`, `shelf-auto-add` setting, Shelf prefs page, CSS,
     README line, `tools/headless/shelf.sh`.
   - Test harness: `session.sh` now creates `home/Downloads`, `home/Pictures`
     and `config/user-dirs.dirs` (the watchers need them; without user-dirs GLib
     returned no Downloads folder in the headless shell), and keeps the folders
     named in `BN_KEEP` across a restart.
2. **Quick Share from the shelf (5.4)**: done in this commit. `src/share.js`
   finds the targets (GSConnect when its bus name has an owner and it lists a
   device; `bluetooth-sendto`; the LocalSend app in `Shell.AppSystem`;
   `xdg-email`). Share opens the targets under the file, inline instead of a
   popup menu, so the notch does not close under the pointer. GSConnect is
   untested (not installed here).
3. **Clipboard history (F18)**, off by default: done in this commit.
   `src/clipboard.js` reads the text on `Meta.Selection` `owner-changed` (no
   polling), keeps 25 entries of at most 2000 characters, newest first, no
   repeats, in memory only, and skips a copy whose clipboard types include
   `x-kde-passwordManagerHint`. The Shelf tab gets a Files | Clipboard toggle
   (only when the setting is on), a click copies an entry back, Clear empties
   the list. The secret check was tested with a stubbed `get_mimetypes`,
   since no real password manager is installed here.

## Notes

- Screenshots: GNOME's screenshot notification carries the image, not the file
  path, so the shelf watches `Pictures/Screenshots` (the English name) for files
  that finish writing.
- The Shelf tab's header label "Today" shows a clipped descender at text size
  1.6. The base branch (`code-quality`) shows the same clip, so it is not from
  this work.
