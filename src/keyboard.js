import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {getInputSourceManager} from 'resource:///org/gnome/shell/ui/status/keyboard.js';

/**
 * Answers two things from the seat the shell already types through: whether
 * Caps Lock is on, and which keyboard layout is active. Both are snapshotted
 * here so that state at enable-time does not pop a peek.
 *
 * Emits 'caps-lock' with the new state and 'layout' with the current input
 * source. The keymap's signal fires on every modifier press, so its
 * handler is a single comparison.
 */
export class KeyboardMonitor extends EventEmitter {
    constructor() {
        super();

        const seat = global.stage.context.get_backend().get_default_seat();
        this._keymap = seat.get_keymap();
        this._capsLock = this._keymap.get_caps_lock_state();
        this._keymap.connectObject('state-changed', () => {
            const capsLock = this._keymap.get_caps_lock_state();
            if (capsLock !== this._capsLock) {
                this._capsLock = capsLock;
                this.emit('caps-lock', capsLock);
            }
        }, this);

        this._sources = getInputSourceManager();
        this._source = this._sources.currentSource?.shortName ?? null;
        this._sources.connectObject('current-source-changed', () => {
            const source = this._sources.currentSource;
            if (!source || source.shortName === this._source)
                return;
            this._source = source.shortName;
            this.emit('layout', source);
        }, this);
    }

    destroy() {
        this._keymap.disconnectObject(this);
        this._sources.disconnectObject(this);
        this.disconnectAll();
    }
}
