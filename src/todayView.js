import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';

import {CalendarSources} from './calendarSources.js';

/**
 * The Today tab, like GNOME's top bar calendar menu: notifications on the
 * left, the month and the selected day's events on the right. Both widgets
 * are GNOME's own, so grouping, dismissing and event loading behave the same.
 */
export const TodayView = GObject.registerClass(
class TodayView extends St.BoxLayout {
    _init(settings, weather) {
        super._init({style_class: 'bn-today', x_expand: true, y_expand: true});
        this.layout_manager.homogeneous = true;
        this._settings = settings;
        this._weather = weather;
        this._sources = new CalendarSources();

        this._messages = new Calendar.CalendarMessageList();
        this._messages.add_style_class_name('bn-messages');
        this.add_child(this._messages);

        // The calendar side takes the other half and keeps the calendar
        // centred in it. The events list is as wide as the calendar, so it
        // lines up under it, and scrolls when a day has more events than fit,
        // instead of pushing the calendar around.
        const side = new St.Bin({
            style_class: 'bn-today-side',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.FILL,
        });
        this.add_child(side);
        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-today-column',
            x_align: Clutter.ActorAlign.CENTER,
            y_expand: true,
        });
        side.child = column;

        this._eventSource = new Calendar.DBusEventSource();
        this._calendar = new Calendar.Calendar();
        this._calendar.setEventSource(this._eventSource);
        this._calendar.connect('selected-date-changed', (_c, datetime) => {
            this._date = new Date(datetime.to_unix() * 1000);
            this._syncEvents();
        });
        column.add_child(this._calendar);

        // Today's weather under the calendar, hidden until there is an answer.
        this._weatherRow = new St.BoxLayout({style_class: 'bn-weather', x_align: Clutter.ActorAlign.CENTER});
        this._weatherIcon = new St.Icon({style_class: 'bn-weather-icon', y_align: Clutter.ActorAlign.CENTER});
        this._weatherText = new St.Label({style_class: 'bn-weather-text', y_align: Clutter.ActorAlign.CENTER});
        this._weatherRow.add_child(this._weatherIcon);
        this._weatherRow.add_child(this._weatherText);
        column.add_child(this._weatherRow);

        this._eventsTitle = new St.Label({style_class: 'bn-events-title'});
        this._events = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-events',
        });
        const scroll = new St.ScrollView({
            style_class: 'bn-events-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
            child: this._events,
        });
        // The calendar alone sets the column's width. Without this, long
        // event titles widen the column and the calendar slides sideways;
        // with it they are cut short with an ellipsis.
        scroll.natural_width = 0;
        this._eventsTitle.natural_width = 0;
        column.add_child(this._eventsTitle);
        column.add_child(scroll);

        this._date = new Date();
        this._eventSource.connectObject('changed', () => this._syncEvents(), this);
        this._sources.connectObject('changed', () => this._syncEvents(), this);
        settings.connectObject(
            'changed::hide-all-day-events', () => this._syncEvents(),
            'changed::event-colors', () => this._syncEvents(),
            'changed::weather-place', () => this._syncWeather(),
            this);
        weather.connectObject('changed', () => this._syncWeather(), this);
        this._syncWeather();
        this.connect('destroy', () => {
            weather.disconnectObject(this);
            this._eventSource.destroy();
            this._sources.destroy();
        });
    }

    // The next timed event today that has not started yet, for the Home
    // tab, or null. It reads the events the calendar has loaded.
    nextEvent() {
        const now = new Date();
        const end = new Date(now);
        end.setHours(24, 0, 0, 0);
        return this._eventSource.getEvents(now, end).find(event => event.date > now) ?? null;
    }

    // The calendar's events, shared with the meeting countdown.
    get eventSource() {
        return this._eventSource;
    }

    // Back to today each time the tab opens.
    reset() {
        this._date = new Date();
        this._calendar.setDate(this._date);
        this._syncEvents();
    }

    _syncWeather() {
        const weather = this._weather.weather;
        this._weatherRow.visible = weather !== null;
        if (!weather)
            return;
        const place = this._settings.get_string('weather-place');
        this._weatherIcon.icon_name = weather.icon;
        this._weatherText.text = [place, `${weather.temperature}°`, `H ${weather.high}° · L ${weather.low}°`]
            .filter(part => part !== '').join('  ');
    }

    _syncEvents() {
        const begin = new Date(this._date);
        begin.setHours(0, 0, 0, 0);
        const end = new Date(begin);
        end.setDate(end.getDate() + 1);

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const datetime = GLib.DateTime.new_from_unix_local(begin.getTime() / 1000);
        this._eventsTitle.text = begin.getTime() === today.getTime()
            ? 'Today'
            : datetime.format('%A %e %B').replace(/\s+/g, ' ');

        this._events.destroy_all_children();
        const events = this._eventSource.getEvents(begin, end);
        const showColors = this._settings.get_boolean('event-colors');
        for (const event of events) {
            const allDay = event.date <= begin && event.end >= end;
            if (allDay && this._settings.get_boolean('hide-all-day-events'))
                continue;
            const row = new St.BoxLayout({style_class: 'bn-event'});
            // A bar in the calendar's colour. Without a colour it is clear,
            // so the times still line up.
            if (showColors) {
                row.add_child(new St.Widget({
                    style_class: 'bn-event-color',
                    style: `background-color: ${this._sources.colorOf(event.id) ?? 'transparent'};`,
                }));
            }
            const start = GLib.DateTime.new_from_unix_local(event.date.getTime() / 1000);
            row.add_child(new St.Label({
                style_class: 'bn-event-time',
                text: allDay ? 'All day' : start.format('%H:%M'),
            }));
            row.add_child(new St.Label({style_class: 'bn-event-summary', text: event.summary, x_expand: true}));
            this._events.add_child(row);
        }
        if (this._events.get_n_children() === 0)
            this._events.add_child(new St.Label({style_class: 'bn-event-empty', text: 'No events'}));
    }
});
