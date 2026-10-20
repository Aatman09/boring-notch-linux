import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {AlbumArt, formatTime} from './widgets.js';

const formatSeconds = s => formatTime(s * GLib.USEC_PER_SEC);

const TICK_MS = 500;
const TIMER_PRESETS = [1, 5, 10, 15, 25];

export const TABS = [
    {id: 'home', label: 'Home', icon: 'user-home-symbolic'},
    {id: 'today', label: 'Today', icon: 'x-office-calendar-symbolic'},
    {id: 'timer', label: 'Timer', icon: 'alarm-symbolic'},
];

function iconButton(iconName, styleClass, callback) {
    const button = new St.Button({
        style_class: `bn-button ${styleClass}`,
        can_focus: true,
        child: new St.Icon({icon_name: iconName}),
    });
    button.connect('clicked', callback);
    return button;
}

/** BoringHeader: tabs on the left, settings and battery on the right. */
const Header = GObject.registerClass({
    Signals: {'tab-selected': {param_types: [GObject.TYPE_STRING]}},
}, class Header extends St.BoxLayout {
    _init(battery, openPreferences) {
        super._init({style_class: 'bn-header', x_expand: true});
        this._battery = battery;

        this._tabs = new Map();
        for (const {id, label, icon} of TABS) {
            const box = new St.BoxLayout({style_class: 'bn-tab-content'});
            box.add_child(new St.Icon({icon_name: icon, style_class: 'bn-tab-icon'}));
            box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            const tab = new St.Button({style_class: 'bn-tab', child: box, can_focus: true});
            tab.connect('clicked', () => this.emit('tab-selected', id));
            this._tabs.set(id, tab);
            this.add_child(tab);
        }

        this._dot = new St.Widget({style_class: 'bn-unread-dot', visible: false, y_align: Clutter.ActorAlign.CENTER});
        this._tabs.get('today').child.add_child(this._dot);

        this.add_child(new St.Widget({x_expand: true}));

        this.add_child(iconButton('emblem-system-symbolic', 'bn-header-button', openPreferences));

        this._batteryBox = new St.BoxLayout({style_class: 'bn-header-battery'});
        this._batteryLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._batteryIcon = new St.Icon({style_class: 'bn-header-battery-icon'});
        this._batteryBox.add_child(this._batteryLabel);
        this._batteryBox.add_child(this._batteryIcon);
        this.add_child(this._batteryBox);

        battery.connectObject('changed', () => this._syncBattery(), this);
        this._syncBattery();
    }

    setActiveTab(id) {
        for (const [tabId, tab] of this._tabs) {
            if (tabId === id)
                tab.add_style_pseudo_class('checked');
            else
                tab.remove_style_pseudo_class('checked');
        }
    }

    setUnread(unread) {
        this._dot.visible = unread;
    }

    _syncBattery() {
        this._batteryBox.visible = this._battery.present;
        this._batteryLabel.text = `${this._battery.percentage}%`;
        this._batteryIcon.icon_name = this._battery.iconName;
    }
});

/** The music player from NotchHomeView. */
const MediaPlayer = GObject.registerClass(
class MediaPlayer extends St.BoxLayout {
    _init() {
        super._init({style_class: 'bn-player', x_expand: true, y_expand: true});

        this._art = new AlbumArt('bn-art');
        this._art.reactive = true;
        this._art.connect('button-press-event', () => {
            this._player?.raise();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._art);

        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-player-column',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(column);

        this._title = new St.Label({style_class: 'bn-title'});
        this._artist = new St.Label({style_class: 'bn-artist'});
        column.add_child(this._title);
        column.add_child(this._artist);

        this._slider = new Slider.Slider(0);
        this._slider.add_style_class_name('bn-progress');
        this._slider.x_expand = true;
        this._slider.connect('drag-begin', () => {
            this.dragging = true;
        });
        this._slider.connect('drag-end', () => {
            this.dragging = false;
            this._player?.seek(this._slider.value);
        });
        // Clicks and scrolls on the bar change the value without a drag.
        this._slider.connect('notify::value', () => {
            if (this._syncing)
                return;
            if (this.dragging)
                this._syncTimes(this._slider.value * (this._player?.length ?? 0));
            else
                this._player?.seek(this._slider.value);
        });
        column.add_child(this._slider);

        const times = new St.BoxLayout({style_class: 'bn-times'});
        this._elapsed = new St.Label({style_class: 'bn-time'});
        this._remaining = new St.Label({style_class: 'bn-time', x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._elapsed);
        times.add_child(this._remaining);
        column.add_child(times);

        const controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        this._shuffle = iconButton('media-playlist-shuffle-symbolic', 'bn-toggle', () => this._player?.toggleShuffle());
        this._previous = iconButton('media-skip-backward-symbolic', '', () => this._player?.previous());
        this._playPause = iconButton('media-playback-start-symbolic', 'bn-play', () => this._player?.playPause());
        this._next = iconButton('media-skip-forward-symbolic', '', () => this._player?.next());
        this._loop = iconButton('media-playlist-repeat-symbolic', 'bn-toggle', () => this._player?.cycleLoop());
        [this._shuffle, this._previous, this._playPause, this._next, this._loop]
            .forEach(b => controls.add_child(b));
        column.add_child(controls);

        this.dragging = false;
    }

    update(player, artUri) {
        this._player = player;
        this._art.set_art(artUri);
        this._title.text = player.title;
        this._artist.text = player.artists || player.identity;
        this._playPause.child.icon_name = player.playing
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._previous.reactive = player.canGoPrevious;
        this._next.reactive = player.canGoNext;
        this._slider.reactive = player.canSeek;

        this._setChecked(this._shuffle, player.shuffle);
        this._setChecked(this._loop, player.loopStatus !== 'None');
        this._loop.child.icon_name = player.loopStatus === 'Track'
            ? 'media-playlist-repeat-song-symbolic'
            : 'media-playlist-repeat-symbolic';

        this.tick();
    }

    _setChecked(button, checked) {
        if (checked)
            button.add_style_pseudo_class('checked');
        else
            button.remove_style_pseudo_class('checked');
    }

    tick() {
        if (!this._player || this.dragging)
            return;
        const {position, length} = this._player;
        this._syncing = true;
        this._slider.value = length > 0 ? position / length : 0;
        this._syncing = false;
        this._syncTimes(position);
    }

    _syncTimes(position) {
        const length = this._player?.length ?? 0;
        this._elapsed.text = formatTime(position);
        this._remaining.text = length > 0 ? `-${formatTime(length - position)}` : '';
    }
});

/** What the notch shows when nothing is playing: the time and date. */
const IdleView = GObject.registerClass(
class IdleView extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-idle',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._time = new St.Label({style_class: 'bn-idle-time', x_align: Clutter.ActorAlign.CENTER});
        this._date = new St.Label({style_class: 'bn-idle-date', x_align: Clutter.ActorAlign.CENTER});
        const hint = new St.Label({
            style_class: 'bn-idle-hint',
            text: 'Play something to see it here',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._time);
        this.add_child(this._date);
        this.add_child(hint);
        this.tick();
    }

    tick() {
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format('%H:%M');
        this._date.text = now.format('%A, %e %B').replace(/\s+/g, ' ');
    }
});

/**
 * The Today tab, like GNOME's top bar calendar menu: notifications on the
 * left, the month and the selected day's events on the right. Both widgets
 * are GNOME's own, so grouping, dismissing and event loading behave the same.
 */
const TodayView = GObject.registerClass(
class TodayView extends St.BoxLayout {
    _init() {
        super._init({style_class: 'bn-today', x_expand: true, y_expand: true});
        this.layout_manager.homogeneous = true;

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
        column.add_child(this._eventsTitle);
        column.add_child(scroll);

        this._date = new Date();
        this._eventSource.connectObject('changed', () => this._syncEvents(), this);
        this.connect('destroy', () => this._eventSource.destroy());
    }

    // Back to today each time the tab opens.
    reset() {
        this._date = new Date();
        this._calendar.setDate(this._date);
        this._syncEvents();
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
        for (const event of events) {
            const row = new St.BoxLayout({style_class: 'bn-event'});
            const allDay = event.date <= begin && event.end >= end;
            const start = GLib.DateTime.new_from_unix_local(event.date.getTime() / 1000);
            row.add_child(new St.Label({
                style_class: 'bn-event-time',
                text: allDay ? 'All day' : start.format('%H:%M'),
            }));
            row.add_child(new St.Label({style_class: 'bn-event-summary', text: event.summary, x_expand: true}));
            this._events.add_child(row);
        }
        if (events.length === 0)
            this._events.add_child(new St.Label({style_class: 'bn-event-empty', text: 'No events'}));
    }
});

/** The Timer tab: presets, then start, pause and reset. */
const TimerView = GObject.registerClass(
class TimerView extends St.BoxLayout {
    _init(timer) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-timer',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._timer = timer;
        this._minutes = 5;

        this._time = new St.Label({style_class: 'bn-timer-time', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._time);

        const presets = new St.BoxLayout({style_class: 'bn-timer-presets', x_align: Clutter.ActorAlign.CENTER});
        this._presets = TIMER_PRESETS.map(minutes => {
            const button = new St.Button({style_class: 'bn-chip', label: `${minutes} min`, can_focus: true});
            button.connect('clicked', () => {
                this._minutes = minutes;
                this._timer.start(minutes * 60);
            });
            button._minutes = minutes;
            presets.add_child(button);
            return button;
        });
        this.add_child(presets);

        const controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        this._playPause = iconButton('media-playback-start-symbolic', 'bn-play', () => {
            if (this._timer.running)
                this._timer.pause();
            else if (this._timer.active)
                this._timer.resume();
            else
                this._timer.start(this._minutes * 60);
        });
        this._reset = iconButton('view-refresh-symbolic', '', () => this._timer.reset());
        controls.add_child(this._playPause);
        controls.add_child(this._reset);
        this.add_child(controls);

        timer.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    _sync() {
        const timer = this._timer;
        this._time.text = formatSeconds(timer.active ? timer.remaining : this._minutes * 60);
        this._playPause.child.icon_name = timer.running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._reset.reactive = timer.active;
        const selected = timer.active ? Math.round(timer.duration / 60) : this._minutes;
        for (const button of this._presets) {
            if (button._minutes === selected)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }
    }
});

// Where pages wait while another tab is showing: still laid out and
// styled, so switching tabs costs nothing, but clipped out of sight.
const PARKED_Y = -10000;

/**
 * Everything inside the open notch. Each tab's page keeps its own fixed
 * size and stays laid out; changing tab only moves pages in and out of
 * view, so opening on any tab never has to lay out a page again.
 */
export const OpenView = GObject.registerClass({
    Signals: {'tab-selected': {param_types: [GObject.TYPE_STRING]}},
}, class OpenView extends St.Widget {
    _init({battery, timer, openPreferences}) {
        super._init({style_class: 'bn-open', opacity: 0});

        this._header = new Header(battery, openPreferences);
        this._header.connect('tab-selected', (_h, id) => this.emit('tab-selected', id));
        this.add_child(this._header);

        this._player = new MediaPlayer();
        this._idle = new IdleView();
        const home = new St.Widget({layout_manager: new Clutter.BinLayout()});
        home.add_child(this._player);
        home.add_child(this._idle);
        this._today = new TodayView();
        this._pages = {home, today: this._today, timer: new TimerView(timer)};
        Object.values(this._pages).forEach(page => this.add_child(page));

        this._sizes = null;
        this.update(null, null);
        this.setTab('home');
        this.connect('destroy', () => this.stopTicking());
    }

    setTab(id) {
        this._tab = id;
        for (const [pageId, page] of Object.entries(this._pages))
            page.translation_y = pageId === id ? 0 : PARKED_Y;
        this._header.setActiveTab(id);
        this._layoutHeader();
        if (id === 'today')
            this._today.reset();
    }

    setUnread(unread) {
        this._header.setUnread(unread);
    }

    // `sizes` maps each tab to its [width, height] in actor pixels,
    // header included.
    setGeometry(sizes, headerHeight) {
        this._sizes = sizes;
        this._headerHeight = headerHeight;
        for (const [id, page] of Object.entries(this._pages)) {
            const [width, height] = sizes[id];
            page.set_position(0, headerHeight);
            page.set_size(width, Math.max(0, height - headerHeight));
        }
        this._layoutHeader();
    }

    _layoutHeader() {
        if (!this._sizes)
            return;
        const [width] = this._sizes[this._tab];
        this._header.set_position(0, 0);
        this._header.set_size(width, this._headerHeight);
    }

    get busy() {
        return this._player.dragging;
    }

    update(player, artUri) {
        this._player.visible = !!player;
        this._idle.visible = !player;
        if (player)
            this._player.update(player, artUri);
    }

    startTicking() {
        if (this._tickId)
            return;
        this._tick();
        this._tickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopTicking() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
    }

    _tick() {
        if (!this._pages.home.visible)
            return;
        if (this._player.visible)
            this._player.tick();
        else
            this._idle.tick();
    }
});
