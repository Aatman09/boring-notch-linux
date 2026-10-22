import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// How close below the closed notch a drag has to come to open it.
const REACH = 24;
// After a drag ends over the notch, how long the drop has to arrive and the
// notch stays open to show the new files.
const SETTLE_MS = 1500;

/**
 * Drag and drop onto the notch, adding the dropped files to the shelf.
 *
 * GNOME Shell is told where a drag is but never given what is dragged; on
 * Wayland only an app's window can take a drop. So when a drag begins this
 * starts a small transparent helper window (helper/dropTarget.js). When the
 * drag comes to the notch, the notch opens on the Shelf tab, the helper is
 * placed under it, and the notch lets the pointer through, so the drop
 * lands on the helper, which reports the files and quits.
 *
 * `island` is the host: open(tab), rectFor(tab), setDragging(dragging) and
 * setShelfDropHover(hover).
 */
export class ShelfDrop {
    constructor({settings, shelf, island, helperPath}) {
        this._settings = settings;
        this._shelf = shelf;
        this._island = island;
        this._helperPath = helperPath;
        this._process = null;
        this._cancellable = null;
        // The helper's window, once created, and once shown.
        this._created = null;
        this._window = null;
        this._dragging = false;
        this._overNotch = false;
        this._settleId = 0;

        global.backend.get_dnd().connectObject(
            'dnd-enter', () => this._onDragBegin(),
            'dnd-position-change', (_dnd, x, y) => this._onDragMove(x, y),
            'dnd-leave', () => this._onDragEnd(),
            this);
        global.display.connectObject('window-created',
            (_display, window) => this._onWindowCreated(window), this);
    }

    get _enabled() {
        return this._settings.get_boolean('show-shelf') && this._settings.get_boolean('shelf-drop');
    }

    _onDragBegin() {
        if (!this._enabled)
            return;
        this._clearSettle();
        this._dragging = true;
        this._overNotch = false;
        this._start();
    }

    // Opens the notch on the Shelf tab once the drag reaches it.
    _onDragMove(x, y) {
        if (!this._dragging || this._overNotch)
            return;
        const notch = this._island.rectFor(null);
        if (x < notch.x || x > notch.x + notch.width || y > notch.y + notch.height + REACH)
            return;
        this._overNotch = true;
        this._island.open('shelf');
        // The notch lets the pointer through to the helper under it.
        this._island.setDragging(true);
        this._place();
    }

    _onDragEnd() {
        if (!this._dragging)
            return;
        this._dragging = false;
        if (!this._overNotch) {
            this._stop();
            return;
        }
        // Keep the notch open a moment: the drop is still on its way, and
        // the new files should be seen.
        this._settleId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SETTLE_MS, () => {
            this._settleId = 0;
            this._stop();
            this._island.setShelfDropHover(false);
            this._island.setDragging(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _start() {
        if (this._process)
            return;
        try {
            this._process = Gio.Subprocess.new(['gjs', '-m', this._helperPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`Boring Notch: cannot start the drop target: ${e.message}`);
            return;
        }
        const process = this._process;
        this._cancellable = new Gio.Cancellable();
        const stdout = new Gio.DataInputStream({base_stream: process.get_stdout_pipe(), close_base_stream: true});
        this._readLine(stdout, this._cancellable);
        process.wait_async(null, () => {
            if (this._process === process)
                this._forget();
        });
    }

    _readLine(stdout, cancellable) {
        stdout.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (stream, result) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(result);
            } catch {
                return;
            }
            if (line === null)
                return;
            try {
                this._onMessage(JSON.parse(line));
            } catch {
                // Not one of the helper's lines (a library warning, say).
            }
            this._readLine(stdout, cancellable);
        });
    }

    _onMessage({event, paths}) {
        if (event === 'enter' || event === 'leave') {
            this._island.setShelfDropHover(event === 'enter');
        } else if (event === 'drop') {
            for (const path of paths.filter(p => typeof p === 'string').reverse())
                this._shelf.add(path);
        }
    }

    // The helper's window is the one its process opens. A Wayland window
    // has no app id yet when it is created, so the process id finds it.
    _onWindowCreated(window) {
        if (!this._process || String(window.get_pid()) !== this._process.get_identifier())
            return;
        // It can only be raised and placed once it is on screen.
        window.connectObject(
            'shown', () => {
                this._window = window;
                window.make_above();
                window.stick();
                this._place();
            },
            'unmanaged', () => {
                this._window = null;
            },
            this);
        this._created = window;
    }

    // The helper covers the open notch while the drag is over it; until
    // then it waits in a one-pixel corner, out of the way of other drops.
    // Windows are kept below the top bar, so the helper starts where the
    // work area does and ends where the open notch ends.
    _place() {
        if (!this._window)
            return;
        const rect = this._island.rectFor(this._overNotch ? 'shelf' : null);
        const top = Math.max(rect.y, this._window.get_work_area_current_monitor().y);
        const height = this._overNotch ? Math.max(1, rect.y + rect.height - top) : 1;
        this._window.move_resize_frame(false, rect.x, top, this._overNotch ? rect.width : 1, height);
    }

    _stop() {
        this._process?.force_exit();
        this._forget();
    }

    _forget() {
        this._cancellable?.cancel();
        this._cancellable = null;
        this._created?.disconnectObject(this);
        this._created = null;
        this._window = null;
        this._process = null;
    }

    _clearSettle() {
        if (this._settleId) {
            GLib.source_remove(this._settleId);
            this._settleId = 0;
        }
    }

    destroy() {
        this._clearSettle();
        global.backend.get_dnd().disconnectObject(this);
        global.display.disconnectObject(this);
        this._stop();
        if (this._dragging || this._overNotch)
            this._island.setDragging(false);
    }
}
