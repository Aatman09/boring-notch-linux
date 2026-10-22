import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.File.prototype, 'enumerate_children_async', 'enumerate_children_finish');
Gio._promisify(Gio.FileEnumerator.prototype, 'next_files_async', 'next_files_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

// Evolution Data Server keeps one key file per calendar here, named after
// the calendar's uid. The event source names each event "<uid>\n<event>",
// so the colour of an event is the colour of the calendar before the newline.
const SOURCES_PATH = ['evolution', 'sources'];
const SOURCE_SUFFIX = '.source';

/**
 * The colour of each calendar, read from the same key files GNOME Calendar
 * uses. Calendars without one, such as online accounts, have no colour.
 * Emits 'changed' once the files are read and whenever they change. The
 * reads are asynchronous, and nothing reads them again until a file changes.
 */
export class CalendarSources extends EventEmitter {
    constructor() {
        super();
        this._colors = new Map();
        this._cancellable = new Gio.Cancellable();
        this._dir = Gio.File.new_for_path(
            GLib.build_filenamev([GLib.get_user_config_dir(), ...SOURCES_PATH]));
        this._monitor = null;
        try {
            this._monitor = this._dir.monitor_directory(Gio.FileMonitorFlags.NONE, null);
            this._monitor.connect('changed', () => this._load());
        } catch {
            // No Evolution folder: there are no calendar colours to show.
        }
        this._load();
    }

    // The colour of the calendar an event belongs to, as #rrggbb, or null.
    colorOf(eventId) {
        return this._colors.get(eventId.split('\n')[0]) ?? null;
    }

    async _load() {
        const colors = new Map();
        try {
            const enumerator = await this._dir.enumerate_children_async(
                'standard::name', Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, this._cancellable);
            let infos;
            while ((infos = await enumerator.next_files_async(32, GLib.PRIORITY_DEFAULT, this._cancellable)).length > 0) {
                for (const info of infos) {
                    const name = info.get_name();
                    if (name.endsWith(SOURCE_SUFFIX))
                        await this._readSource(name, colors);
                }
            }
        } catch (e) {
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;
        }
        this._colors = colors;
        this.emit('changed');
    }

    async _readSource(name, colors) {
        try {
            const [contents] = await this._dir.get_child(name).load_contents_async(this._cancellable);
            const key = new GLib.KeyFile();
            key.load_from_bytes(GLib.Bytes.new(contents), GLib.KeyFileFlags.NONE);
            colors.set(name.slice(0, -SOURCE_SUFFIX.length), key.get_string('Calendar', 'Color'));
        } catch (e) {
            // get_string throws when the file has no calendar colour, and a
            // file that cannot be read has none either.
            if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
        }
    }

    // The owner's connectObject handlers go with the owner, so the signals
    // are not disconnected here: that would be done twice.
    destroy() {
        this._cancellable.cancel();
        this._monitor?.cancel();
        this._monitor = null;
    }
}
