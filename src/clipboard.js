import Meta from 'gi://Meta';
import St from 'gi://St';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

const MAX_ENTRIES = 25;
const MAX_LENGTH = 2000;
// Password managers such as KeePassXC put this type on the clipboard next to
// a secret. Their text is never kept.
const SECRET_TYPE = 'x-kde-passwordManagerHint';

/**
 * The text copied while clipboard-history is on, newest first, kept in
 * memory only. Each copy is read when the clipboard's owner changes, so
 * nothing polls. Emits 'changed' when the list changes.
 */
export class ClipboardHistory extends EventEmitter {
    constructor({settings}) {
        super();
        this._settings = settings;
        this._entries = [];
        this._selection = null;
        settings.connectObject('changed::clipboard-history', () => this._sync(), this);
        this._sync();
    }

    get entries() {
        return [...this._entries];
    }

    clear() {
        if (this._entries.length === 0)
            return;
        this._entries = [];
        this.emit('changed');
    }

    _sync() {
        const on = this._settings.get_boolean('clipboard-history');
        if (on && !this._selection) {
            this._selection = global.display.get_selection();
            this._selection.connectObject('owner-changed', (_s, type) => {
                if (type === Meta.SelectionType.SELECTION_CLIPBOARD)
                    this._read();
            }, this);
        } else if (!on && this._selection) {
            this._selection.disconnectObject(this);
            this._selection = null;
            this.clear();
        }
    }

    _read() {
        const clipboard = St.Clipboard.get_default();
        if (clipboard.get_mimetypes(St.ClipboardType.CLIPBOARD).includes(SECRET_TYPE))
            return;
        clipboard.get_text(St.ClipboardType.CLIPBOARD, (_c, text) => this._add(text));
    }

    _add(text) {
        if (!text || text.trim() === '' || text.length > MAX_LENGTH)
            return;
        this._entries = [text, ...this._entries.filter(entry => entry !== text)].slice(0, MAX_ENTRIES);
        this.emit('changed');
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._selection?.disconnectObject(this);
        this._selection = null;
        this._entries = [];
        this.disconnectAll();
    }
}
