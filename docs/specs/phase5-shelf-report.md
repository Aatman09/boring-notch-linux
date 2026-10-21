# Phase 5 report: shelf, Quick Share, clipboard history

Branch `phase5-shelf`, from `code-quality` (tip `6ec9033`). Three steps, one
commit each, each run through the gate in `next-work-handoff.md`. Nothing is
pushed, and `main`, `code-quality` and the other branches are untouched.

Progress notes: `docs/specs/phase5-shelf-progress.md`.

## Commits

| Commit | What |
|---|---|
| `0d9c191` | Shelf tab (5.1): paste, finished downloads, new screenshots, open, show in folder, remove, clear; paths only, saved to the cache folder |
| `8f49379` | Quick Share on shelf files (5.4): Share lists the targets found here |
| `5bbcf50` | Clipboard history (F18), off by default: text only, in memory, Files / Clipboard toggle |

## What was built

| Feature | Files | Settings |
|---|---|---|
| Shelf store | `src/shelf.js` | `show-shelf`, `shelf-auto-add` |
| Shelf tab | `src/shelfView.js`, `header.js` (tab), `openView.js`, `island.js` (`OPEN_SIZES.shelf`, `open()` guard, `_syncShelfTab`) | `show-shelf` |
| Downloads and screenshots | `src/shelf.js` (download watcher listener, `Pictures/Screenshots` monitors) | `shelf-auto-add` |
| Quick Share | `src/share.js`, `src/shelfView.js` (Share button and inline targets) | `shelf-share` |
| Clipboard history | `src/clipboard.js`, `src/shelfView.js` (mode toggle, clipboard list) | `clipboard-history` |
| Preferences | `prefs.js` (new Shelf page: Shelf, Share and Clipboard groups) | all of the above |
| Styles | `src/style.css` (`bn-shelf-*`) | |
| Test scripts | `tools/headless/shelf.sh`, `tools/headless/session.sh` (see below) | |

The schema has `show-shelf` (true), `shelf-auto-add` (true), `shelf-share`
(true) and `clipboard-history` (false), each with a summary. README has three
lines (Shelf, Quick Share, Clipboard history).

Stored state: `GLib.get_user_cache_dir()/boring-notch-linux/shelf.json` holds
`{"paths": [...]}` and nothing else. The clipboard history is never written.

Deviations from the plan, all deliberate:

- The Share targets open inline under the file (a row of buttons), not in a
  `PopupMenu`. A popup would have to keep the notch open under the pointer
  (`busy`), and the menu would close the notch when it lost the pointer.
- Screenshots are found by watching `Pictures/Screenshots`, not from the
  notification: GNOME's screenshot notification carries the image, not the path
  (`/org/gnome/shell/ui/screenshot.js`, `_saveScreenshot` and `_showNotification`).
  The folder name is the English one; a translated name is not watched.
- The shelf is a list (one row per file), not a grid of tiles.
- Items are not thumbnailed: a file's existing XDG thumbnail is used when there
  is one, otherwise its content-type icon. No image is decoded.
- Clipboard entries longer than 2000 characters are dropped, not cut.

## Evidence per acceptance bullet

Headless shell, `tools/headless`, `BN_TEST_DIR=/tmp/bn-test-haiku-shelf`.
Evidence PNGs are in `docs/specs/phase5-shelf-evidence/`.

### Step 1: Shelf (`shelf.sh`, all checks pass)

- **Paste** (`St.Clipboard.set_content` with `text/uri-list`, then `_paste`):
  two files added, first pasted is newest; one row per file; the list is written
  to `cache/boring-notch-linux/shelf.json`.
- **Downloads:** a `movie.mkv.part` renamed to `movie.mkv` is added. Browser
  downloads themselves were not run.
- **Screenshots:** a file written into `home/Pictures/Screenshots/` is added.
  The test creates the folder and toggles `shelf-auto-add` so the watch starts
  (see the doubts: a fresh home without the folder).
- **Remove** (the row's Remove button) takes one file off.
- **Missing files:** a deleted file leaves the list when the tab is opened again.
- **Restart:** with `BN_KEEP="cache files"` the session is restarted and the
  shelf is the same afterwards.
- **Screens:** `shelf-tab-125.png` (125%, text 1.25); `files-tab-100-text-1-6.png`
  (100%, text 1.6, header and bar fit); `prefs-shelf-page.png` (Preferences).
- **Header at text size 1.6:** with four tabs the header fits at 125% and 100%.
  The "Today" label shows a clipped descender ("Todav"). The base branch shows
  the same clip with three tabs, so it is not from this work.

### Step 2: Quick Share (`shelf.sh`, all checks pass)

- **Targets found here:** Bluetooth (`bluetooth-sendto`), LocalSend (its app in
  `Shell.AppSystem`) and Email (`xdg-email`). GSConnect is not running here.
  `shelf.sh` checks that Share lists at least one target.
- **Share button** appears per file when `shelf-share` is on and goes when it is
  off (checked by toggling the setting).
- **Email target:** pressed in the session with a stub `xdg-email` on `PATH`; the
  stub received `--attach <file>`. The real `xdg-email` was not run.
- **Screen:** `shelf-share-targets-125.png` (the inline targets under a file).
- Prefs: `prefs-shelf-page.png` shows the Share group.

### Step 3: Clipboard history (`shelf.sh`, all checks pass)

- **Order and dedupe:** copies with `St.Clipboard.set_text` are listed newest
  first, and a repeated text moves to the top.
- **Length:** a 2001-character text is not kept.
- **Secrets:** with `St`'s `get_mimetypes` stubbed to return
  `x-kde-passwordManagerHint`, a copy is not kept.
- **Clipboard list:** one row per copied text; a click copies that text back
  (read back with `get_text`); Clear empties the list.
- **Off:** turning the setting off empties the list, and later copies are not
  read.
- **Disk:** no copied text appears anywhere under the cache folder.
- **Screens:** `clipboard-list-100-text-1-6.png` (100%, text 1.6);
  `files-tab-100-text-1-6.png` (Files mode with the toggle).

### Gate, final code (after `5bbcf50`)

- `glib-compile-schemas --strict schemas`: clean.
- Fresh session at 125% (`session.sh --fractional`): `smoke.sh` prints "all
  checks passed", including disable, enable, enable (one notch, no doubled
  handlers). `shelf.sh`: all pass. `actions.sh`: all pass.
- Fresh session at 100% (`session.sh 2560x1440`): `smoke.sh` passes.
- `prefs.sh`: all six pages open and are screenshotted, no errors.
- Log: `JS ERROR`, `CRITICAL` and `not in the stage` counts are 0 in every
  session above.

## CPU

Closed notch, nothing playing, idle. Each number is utime+stime of the shell
pid over 30 s (`/proc/PID/stat`, `awk`). Not a controlled comparison: the
readings vary by more than their difference.

| State | Readings |
|---|---|
| Base `code-quality`, 125%, two windows | 0.73%, 0.20% |
| Shelf step 1, 125%, after smoke | 0.17%, 0.23% |
| Shelf step 1, 125%, after actions | 0.67% |
| Final, 100%, clipboard history on, text 1.6 | 0.43%, 0.37% |
| Final, 100%, defaults restored | 0.40%, 0.23%, 0.17% |

Nothing polls. The shelf uses file monitors (inotify) on the Downloads and
Pictures folders when `shelf-auto-add` is on, and the clipboard history uses
the `owner-changed` signal of `global.display.get_selection()` only while
`clipboard-history` is on. The only timer is the save, 500 ms after a change.

## Private GNOME internals used

- `global.display.get_selection()` and the `owner-changed` signal of
  `Meta.Selection` (checked in `Meta-18.typelib` and by connecting in the shell:
  the signal passes the selection, the selection type and the source).
- `St.Clipboard`: `get_content`, `get_text`, `set_text`, `set_content`,
  `get_mimetypes` (all callable in the headless shell).
- `Shell.AppSystem.get_default().get_installed()` (checked: returns the
  `localsend_localsend.desktop` entry).
- `org.freedesktop.FileManager1.ShowItems` on the session bus (public API; not
  reached in the test, see below).
- `org.gnome.Shell.Extensions.GSConnect` (public name, not installed here; see
  doubts).

## Not tested

- **GSConnect**: not installed, so no device, no `org.gtk.Actions` activation and
  no `shareFile` call was made. The action name and its `(sb)` parameter are the
  ones from the plan, not checked against GSConnect's source. The device is the
  first one in GSConnect's introspection. Nothing is said about other devices.
- **LocalSend**: the app was not launched with files. Whether it sends them when
  launched with file arguments is unknown.
- **Bluetooth**: `bluetooth-sendto` was not run; only its presence is detected.
- **Email**: only with the stub; the real `xdg-email` was not run.
- **Share with no target**: the button's hiding when nothing is found was not
  run, because LocalSend is always present on this machine.
- **Show in folder**: the call to `org.freedesktop.FileManager1` and its fallback
  (open the parent folder) were not exercised.
- **Open**: `Gio.AppInfo.launch_default_for_uri` was not exercised.
- **Real copies**: the paste was tested with `St.Clipboard.set_content`, not with
  a copy from Nautilus or any other app (a real copy has an owner other than the
  shell).
- **Real screenshots**: the screenshot file was written by a test script; GNOME's
  own screenshot UI was not used. The shelf sees a file when it is done writing
  (`CHANGES_DONE_HINT`), which the test write produces.
- **Real downloads**: a browser download was not run.
- **Password managers**: no password manager is installed. The secret filter was
  tested only with a stubbed `get_mimetypes`. It is not known whether a real
  manager's hint type is visible to `St.Clipboard.get_mimetypes`.
- **Thumbnails**: no XDG thumbnail was generated in the test, so only the icons
  were seen.
- **Preferences subtitle**: the Clipboard group is partly below the window's
  fold in the screenshot; its title is visible, the subtitle was not looked at.
- **Drag and drop** (step 2 of 5.1 and 5.3): not built, as the task says.
- **Wayland in a real session, the external monitor, real headphones, real
  Bluetooth devices**: not tested.

## Doubts

1. **GSConnect** (see above): the most likely part to be wrong. Treat the Phone
   target as untested.
2. **Screenshot watch needs `Pictures` to exist when the setting turns on.** The
   test creates `Screenshots` after the session starts and toggles the setting
   to start the watch. On a real desktop with no `~/Pictures`, the first
   screenshot would not be added until the setting is toggled or the session
   restarts. Not fixed.
3. **English folder name only** (`Screenshots`). A translated name is not watched.
4. **Missing files** are hidden at once, but they stay in the list until the tab
   is opened again (prune runs on open, as the plan says).
5. **Race in a test:** once, a paste started in the same shell call as
   `set_content` found "No files in the clipboard". Later runs with a short wait
   pass. Not investigated; it may be the clipboard's own latency.
6. **Clipboard secret filter** depends on a hint type that is only known from
   KeePassXC's documentation. Other managers may not set it, so their secrets are
   kept. The settings subtitle says so.
7. **Clipboard owner changes** also fire for the shell's own copy-back. The list
   dedupes, so the order does not change, but the signal is handled.
8. **Header "Today" clip** at text size 1.6 is pre-existing (see step 1).
9. **Prefs Share text** says the targets are found when Share is pressed. The
   button's visibility is also decided when the list is rebuilt, so the text is
   a little simpler than the code.
10. **Test harness changes**: `session.sh` now creates `home/Downloads`,
    `home/Pictures` and `config/user-dirs.dirs` for every session. Before this,
    GLib returned no Downloads folder in the headless shell, so the download
    watcher did nothing there. The existing `smoke.sh` and `actions.sh` pass with
    this. `BN_KEEP` keeps the named folders across a restart.
11. **A stub on PATH** was used for the Email check. It was in `/tmp`, outside
    the repository; it is not in the repository.
12. **CPU readings** are noisy: 0.17% to 0.67% for the same build. The base
    readings (0.73%, 0.20%) are from one session. The comparison does not show a
    difference beyond that noise.
13. **Idle work on the Shelf tab**: each rebuild reads the info of up to 30
    files and calls `shareTargets()`, which lists the installed apps. This
    happens on a change or a tab open, not while idle. Not measured.

## Open items for the author

- Decide whether the Phone (GSConnect) target stays, given it is untested.
- Decide on a fallback for the screenshot folder before it exists.
- Decide whether to drop entries longer than 2000 characters or cut them.
- The drag-and-drop phases (5.2, 5.3) were not started, as the task says.
- Check the header's "Today" descender clip at text size 1.6 (pre-existing).
