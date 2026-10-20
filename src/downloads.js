import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// Stands in for boring.notch's DownloadView. Browsers write downloads to a
// temporary file and rename it when done, so watching the Downloads folder
// for those files works with Firefox, Chrome, Chromium, Edge and Brave.
const PARTIAL_SUFFIXES = ['.part', '.crdownload', '.partial', '.download'];

const isPartial = name => PARTIAL_SUFFIXES.some(s => name.endsWith(s));

/**
 * Emits 'changed' when the number of downloads in progress changes, and
 * 'finished' with the Gio.File of each completed download.
 */
export class DownloadWatcher extends EventEmitter {
    constructor() {
        super();
        this._active = new Set();

        const path = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_DOWNLOAD);
        if (!path)
            return;
        this.folder = Gio.File.new_for_path(path);
        try {
            this._monitor = this.folder.monitor_directory(Gio.FileMonitorFlags.WATCH_MOVES, null);
        } catch (e) {
            console.warn(`Boring Notch: cannot watch ${path}: ${e.message}`);
            return;
        }
        this._monitor.connect('changed', (_m, file, otherFile, event) =>
            this._onChanged(file, otherFile, event));
    }

    get count() {
        return this._active.size;
    }

    _onChanged(file, otherFile, event) {
        const name = file.get_basename();
        const {FileMonitorEvent} = Gio;

        switch (event) {
        case FileMonitorEvent.CREATED:
        case FileMonitorEvent.MOVED_IN:
            if (isPartial(name))
                this._setActive(name, true);
            break;
        case FileMonitorEvent.DELETED:
        case FileMonitorEvent.MOVED_OUT:
            // A cancelled download.
            this._setActive(name, false);
            break;
        case FileMonitorEvent.RENAMED: {
            const newName = otherFile.get_basename();
            const wasPartial = this._active.has(name) || isPartial(name);
            this._setActive(name, false);
            if (isPartial(newName))
                this._setActive(newName, true);
            else if (wasPartial)
                this.emit('finished', otherFile);
            break;
        }
        }
    }

    _setActive(name, active) {
        const had = this._active.has(name);
        if (active === had)
            return;
        if (active)
            this._active.add(name);
        else
            this._active.delete(name);
        this.emit('changed');
    }

    destroy() {
        this._monitor?.cancel();
        this._monitor = null;
        this.disconnectAll();
    }
}
