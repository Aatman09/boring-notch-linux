import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_ITEMS = 30;
const SAVE_DELAY_MS = 500;
const FILE_NAME = 'shelf.json';
// GNOME saves screenshots in this folder under Pictures. The name is
// translated, so a non-English system with another name shows no
// screenshots on the shelf.
const SCREENSHOT_FOLDER = 'Screenshots';

const cacheDir = () => GLib.build_filenamev([GLib.get_user_cache_dir(), 'boring-notch-linux']);

/**
 * The files on the shelf, newest first. Only paths are kept, never copies,
 * so a file that is moved or deleted goes missing from the shelf. The list
 * is saved to the extension's cache folder a moment after each change.
 *
 * Emits 'changed' whenever the list changes. Finished downloads, and new
 * screenshots, are added by themselves while `shelf-auto-add` is on.
 */
export class Shelf extends EventEmitter {
    constructor({settings, downloads}) {
        super();
        this._settings = settings;
        this._paths = this._load();
        this._saveId = 0;
        this._monitors = [];

        downloads.connectObject('finished', (_d, file) => {
            if (settings.get_boolean('shelf-auto-add'))
                this.add(file.get_path());
        }, this);
        settings.connectObject('changed::shelf-auto-add', () => this._syncScreenshots(), this);
        this._syncScreenshots();
    }

    get paths() {
        return [...this._paths];
    }

    add(path) {
        this._paths = [path, ...this._paths.filter(p => p !== path)].slice(0, MAX_ITEMS);
        this._changed();
    }

    remove(path) {
        if (!this._paths.includes(path))
            return;
        this._paths = this._paths.filter(p => p !== path);
        this._changed();
    }

    clear() {
        if (this._paths.length === 0)
            return;
        this._paths = [];
        this._changed();
    }

    // Drops the files that are gone. Called when the shelf is shown.
    prune() {
        const kept = this._paths.filter(path => Gio.File.new_for_path(path).query_exists(null));
        if (kept.length === this._paths.length)
            return;
        this._paths = kept;
        this._changed();
    }

    _changed() {
        this._scheduleSave();
        this.emit('changed');
    }

    _load() {
        try {
            const file = Gio.File.new_for_path(GLib.build_filenamev([cacheDir(), FILE_NAME]));
            const [, contents] = file.load_contents(null);
            const {paths} = JSON.parse(new TextDecoder().decode(contents));
            return Array.isArray(paths)
                ? paths.filter(p => typeof p === 'string').slice(0, MAX_ITEMS)
                : [];
        } catch (e) {
            // No file yet, or one that cannot be read: the shelf starts empty.
            return [];
        }
    }

    _write(sync) {
        const dir = cacheDir();
        GLib.mkdir_with_parents(dir, 0o700);
        const file = Gio.File.new_for_path(GLib.build_filenamev([dir, FILE_NAME]));
        const contents = new TextEncoder().encode(JSON.stringify({paths: this._paths}));
        if (sync) {
            file.replace_contents(contents, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            return;
        }
        file.replace_contents_async(contents, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null, (f, result) => {
                try {
                    f.replace_contents_finish(result);
                } catch (e) {
                    console.warn(`Boring Notch: cannot save the shelf: ${e.message}`);
                }
            });
    }

    // Writes after a pause, so a burst of changes costs one write.
    _scheduleSave() {
        this._clearSave();
        this._saveId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SAVE_DELAY_MS, () => {
            this._saveId = 0;
            this._write(false);
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearSave() {
        if (this._saveId)
            GLib.source_remove(this._saveId);
        this._saveId = 0;
    }

    // Screenshots are watched only while shelf-auto-add is on. GNOME hands
    // the notification the image and not its file, so the folder is watched
    // instead. The Pictures folder is watched as well, to notice the
    // Screenshots folder being made by the first screenshot.
    _syncScreenshots() {
        this._cancelMonitors();
        if (!this._settings.get_boolean('shelf-auto-add'))
            return;
        const pictures = GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES);
        if (!pictures)
            return;
        const folder = Gio.File.new_for_path(pictures);
        this._watch(folder, (file, event) => {
            if (event === Gio.FileMonitorEvent.CREATED && file.get_basename() === SCREENSHOT_FOLDER)
                this._watchScreenshots(file);
        });
        this._watchScreenshots(folder.get_child(SCREENSHOT_FOLDER));
    }

    _watchScreenshots(folder) {
        if (!folder.query_exists(null))
            return;
        this._watch(folder, (file, event) => {
            if (event === Gio.FileMonitorEvent.CHANGES_DONE_HINT && file.get_basename().endsWith('.png'))
                this.add(file.get_path());
        });
    }

    _watch(folder, onEvent) {
        try {
            const monitor = folder.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            monitor.connect('changed', (_m, file, _other, event) => onEvent(file, event));
            this._monitors.push(monitor);
        } catch (e) {
            console.warn(`Boring Notch: cannot watch ${folder.get_path()}: ${e.message}`);
        }
    }

    _cancelMonitors() {
        for (const monitor of this._monitors)
            monitor.cancel();
        this._monitors = [];
    }

    destroy() {
        // The downloads watcher is destroyed first and drops this listener
        // then; disconnecting it again here would throw.
        this._settings.disconnectObject(this);
        this._cancelMonitors();
        // A change not yet written is written now, so closing the
        // extension keeps it.
        if (this._saveId) {
            this._clearSave();
            this._write(true);
        }
        this.disconnectAll();
    }
}
