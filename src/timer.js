import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * Timers linked with exclusive() are exclusive: when one starts counting,
 * the others reset. The countdown, the stopwatch and the Pomodoro are
 * linked this way, wherever they are started from.
 */
export function exclusive(...timers) {
    for (const timer of timers) {
        timer._peers = timers.filter(t => t !== timer);
    }
}

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

    // The figure the notch and the tab show: what is left.
    get seconds() {
        return this.remaining;
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
        // Starting counts as starting: the peers give way.
        this._peers?.forEach(peer => peer.reset());
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

/**
 * A stopwatch that counts up from zero. Emits 'changed' every second while
 * it runs and on every state change.
 */
export class Stopwatch extends EventEmitter {
    constructor() {
        super();
        this._elapsed = 0;
        this._startTime = 0;
        this._tickId = 0;
    }

    // Whole seconds counted so far.
    get seconds() {
        return Math.floor(this._microseconds() / GLib.USEC_PER_SEC);
    }

    get running() {
        return this._tickId !== 0;
    }

    // Counting, or paused with time on the clock.
    get active() {
        return this.running || this._elapsed > 0;
    }

    start() {
        this._elapsed = 0;
        this.resume();
    }

    resume() {
        if (this.running)
            return;
        // Starting counts as starting: the peers give way.
        this._peers?.forEach(peer => peer.reset());
        this._startTime = GLib.get_monotonic_time();
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
            this.emit('changed');
            return GLib.SOURCE_CONTINUE;
        });
        this.emit('changed');
    }

    pause() {
        if (!this.running)
            return;
        this._elapsed = this._microseconds();
        this._stopTicking();
        this.emit('changed');
    }

    reset() {
        this._stopTicking();
        this._elapsed = 0;
        this.emit('changed');
    }

    _microseconds() {
        if (!this.running)
            return this._elapsed;
        return this._elapsed + GLib.get_monotonic_time() - this._startTime;
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

/**
 * Work and break phases, one after the other: work, then break, then work
 * again, each starting as the last ends. The phase lengths come from the
 * settings. Emits 'changed' as the countdown ticks, and 'finished' with the
 * phase that ended when one ends.
 */
export class Pomodoro extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._countdown = new Timer();
        this._work = true;
        this._countdown.connectObject(
            'changed', () => this.emit('changed'),
            'finished', () => this._onFinished(),
            this);
    }

    get seconds() {
        return this._countdown.remaining;
    }

    get phase() {
        return this._work ? 'work' : 'break';
    }

    get running() {
        return this._countdown.running;
    }

    get active() {
        return this._countdown.active;
    }

    start() {
        // Starting counts as starting: the peers give way.
        this._peers?.forEach(peer => peer.reset());
        this._work = true;
        this._countdown.start(this._phaseSeconds());
    }

    resume() {
        this._peers?.forEach(peer => peer.reset());
        this._countdown.resume();
    }

    pause() {
        this._countdown.pause();
    }

    reset() {
        this._work = true;
        this._countdown.reset();
    }

    _phaseSeconds() {
        const key = this._work ? 'pomodoro-work-minutes' : 'pomodoro-break-minutes';
        return this._settings.get_int(key) * 60;
    }

    _onFinished() {
        const ended = this.phase;
        this._work = !this._work;
        this._countdown.start(this._phaseSeconds());
        this.emit('finished', ended);
    }

    destroy() {
        this._countdown.destroy();
        this.disconnectAll();
    }
}
