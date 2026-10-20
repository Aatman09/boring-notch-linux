import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * A countdown timer. Emits 'changed' every second while it runs and on
 * every state change, and 'finished' when it reaches zero.
 */
export class Timer extends EventEmitter {
    constructor() {
        super();
        this._duration = 0;
        this._remaining = 0;
        this._endTime = 0;
        this._tickId = 0;
    }

    // Seconds left, rounded up so the display reaches 0:00 exactly at the end.
    get remaining() {
        if (!this.running)
            return Math.ceil(this._remaining);
        return Math.max(0, Math.ceil((this._endTime - GLib.get_monotonic_time()) / GLib.USEC_PER_SEC));
    }

    get duration() {
        return this._duration;
    }

    get running() {
        return this._tickId !== 0;
    }

    // Set but not running: paused part-way, or chosen and not started.
    get active() {
        return this.running || this._remaining > 0;
    }

    start(seconds) {
        this._stopTicking();
        this._duration = seconds;
        this._remaining = seconds;
        this.resume();
    }

    resume() {
        if (this.running || this._remaining <= 0)
            return;
        this._endTime = GLib.get_monotonic_time() + this._remaining * GLib.USEC_PER_SEC;
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            if (this.remaining > 0) {
                this.emit('changed');
                return GLib.SOURCE_CONTINUE;
            }
            this._tickId = 0;
            this._remaining = 0;
            this.emit('changed');
            this.emit('finished');
            return GLib.SOURCE_REMOVE;
        });
        this.emit('changed');
    }

    pause() {
        if (!this.running)
            return;
        this._remaining = (this._endTime - GLib.get_monotonic_time()) / GLib.USEC_PER_SEC;
        this._stopTicking();
        this.emit('changed');
    }

    reset() {
        this._stopTicking();
        this._remaining = 0;
        this.emit('changed');
    }

    _stopTicking() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    destroy() {
        this._stopTicking();
        this.disconnectAll();
    }
}
