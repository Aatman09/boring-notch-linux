import GLib from 'gi://GLib';

// Which peek wins when several arrive together. A higher one shows at once;
// a lower one waits for its turn.
export const Priority = {MUSIC: 0, STATUS: 1, NOTIFICATION: 2, HUD: 3};

// Peeks still waiting after this long are dropped rather than shown late.
const STALE_US = 10 * GLib.USEC_PER_SEC;

/**
 * The peeks waiting for the closed notch, one showing at a time.
 *
 * A peek is {view, apply, timeout, action, priority, key}. Peeks share
 * views, so `apply` fills the view in when the peek's turn comes. A peek
 * with the same `key` as the one showing replaces it and restarts its time,
 * so repeated volume presses update one peek instead of queueing many.
 *
 * `onShow(peek)` runs when a peek's turn comes and `onIdle()` when the last
 * one has ended. `canContinue()` says whether the next peek may follow the
 * one that ended (not while the notch is open).
 */
export class PeekQueue {
    constructor({onShow, onIdle, canContinue}) {
        this._onShow = onShow;
        this._onIdle = onIdle;
        this._canContinue = canContinue;
        this._peeks = [];
        this._timeoutId = 0;
    }

    // The peek showing, or null.
    get current() {
        return this._peeks[0] ?? null;
    }

    get length() {
        return this._peeks.length;
    }

    show({view, apply = null, timeout, action = null, priority = Priority.STATUS, key = null}) {
        const peek = {view, apply, timeout, action, priority, key, queued: GLib.get_monotonic_time()};
        const head = this._peeks[0];

        if (key && head?.key === key) {
            this._peeks[0] = peek;
            this._start(peek);
            return;
        }
        if (key)
            this._peeks = this._peeks.filter((p, i) => i === 0 || p.key !== key);

        if (!head || priority >= head.priority) {
            this._peeks.unshift(peek);
            this._start(peek);
            return;
        }
        // Wait behind the one showing and anything more important.
        const index = this._peeks.findIndex((p, i) => i > 0 && p.priority < priority);
        this._peeks.splice(index < 0 ? this._peeks.length : index, 0, peek);
    }

    // Ends the peek showing and moves on to the next one.
    end() {
        this._stopTimeout();
        this._peeks.shift();
        const now = GLib.get_monotonic_time();
        this._peeks = this._peeks.filter(p => now - p.queued < STALE_US);
        if (this._peeks.length > 0 && this._canContinue()) {
            this._start(this._peeks[0]);
            return;
        }
        this._peeks = [];
        this._onIdle();
    }

    // Ends the peek showing if it uses `view`.
    endIfShowing(view) {
        if (this.current?.view === view)
            this.end();
    }

    // Drops every peek at once, without onIdle: the caller is changing
    // what the notch shows anyway.
    clear() {
        this._stopTimeout();
        this._peeks = [];
    }

    _start(peek) {
        peek.apply?.();
        this._arm(peek);
        this._onShow(peek);
    }

    _arm(peek) {
        this._stopTimeout();
        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, peek.timeout, () => {
            this._timeoutId = 0;
            // A bar the pointer is on or dragging would vanish under the
            // hand; give it another turn of the timeout instead.
            if (peek.view.isInUse?.())
                this._arm(peek);
            else
                this.end();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    destroy() {
        this.clear();
    }
}
