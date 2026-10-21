import GLib from 'gi://GLib';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * The next timed event that starts within the window set by
 * meeting-lead-minutes, for the countdown in the closed notch. It has its
 * own event source, so the Today tab's month range does not change what it
 * sees. Emits 'changed' whenever it recomputes, which is when the source
 * changes, the settings change, the window opens, the event starts, or a
 * minute passes while the countdown is shown. Between those it sleeps.
 */
export class UpcomingEvents extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._source = new Calendar.DBusEventSource();
        this._shown = true;
        this._event = null;
        this._timeoutId = 0;
        this._midnightId = 0;
        this._source.connectObject('changed', () => this._update(), this);
        this._settings.connectObject(
            'changed::show-next-event', () => this._update(),
            'changed::meeting-lead-minutes', () => this._update(),
            this);
        this._requestRange();
        this._update();
    }

    // The event counting down, or null when none starts within the window.
    get event() {
        return this._event;
    }

    // Whole minutes until the event starts, rounded up.
    get minutesLeft() {
        return Math.ceil((this._event.date.getTime() - Date.now()) / MINUTE_MS);
    }

    // Whether the closed notch shows the countdown. While the notch is open
    // nobody reads it, so the minutes are not counted.
    set shown(shown) {
        this._shown = shown;
        this._update();
    }

    _update() {
        this._clearTimeout();
        const now = Date.now();
        const next = this._settings.get_boolean('show-next-event') ? this._nextTimed(now) : null;
        const lead = this._settings.get_int('meeting-lead-minutes') * MINUTE_MS;
        const inWindow = next !== null && next.date.getTime() - now <= lead;
        this._event = inWindow ? next : null;

        if (next !== null) {
            const untilStart = next.date.getTime() - now;
            let wait = inWindow ? untilStart : untilStart - lead;
            if (inWindow && this._shown)
                wait = Math.min(wait, MINUTE_MS);
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(1, wait), () => {
                this._timeoutId = 0;
                this._update();
                return GLib.SOURCE_REMOVE;
            });
        }
        this.emit('changed');
    }

    // The first event that has not started yet and is not an all-day one.
    _nextTimed(now) {
        return this._source.getEvents(new Date(now), new Date(now + DAY_MS))
            .find(event => event.date.getTime() > now &&
                event.end.getTime() - event.date.getTime() < DAY_MS) ?? null;
    }

    // The range covers today and tomorrow, so every event in the next day is
    // loaded. It is asked for again at each midnight.
    _requestRange() {
        const begin = new Date();
        begin.setHours(0, 0, 0, 0);
        const end = new Date(begin);
        end.setDate(end.getDate() + 2);
        this._source.requestRange(begin, end);

        const midnight = new Date(begin);
        midnight.setDate(midnight.getDate() + 1);
        this._midnightId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, midnight - Date.now(), () => {
            this._midnightId = 0;
            this._requestRange();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearTimeout() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    // The island's connections to this object are left to the island, which
    // removes them when it is destroyed; removing them here would make that fail.
    destroy() {
        this._clearTimeout();
        if (this._midnightId) {
            GLib.source_remove(this._midnightId);
            this._midnightId = 0;
        }
        this._source.disconnectObject(this);
        this._source.destroy();
        this._settings.disconnectObject(this);
    }
}
