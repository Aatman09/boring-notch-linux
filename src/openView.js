import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';
import * as Calendar from 'resource:///org/gnome/shell/ui/calendar.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {BatteryPanel} from './batteryPanel.js';
import {CalendarSources} from './calendarSources.js';
import {AlbumArt, MarqueeLabel, formatTime} from './widgets.js';

const formatSeconds = s => formatTime(s * GLib.USEC_PER_SEC);

const TICK_MS = 500;
const HEADER_HUD_MS = 1500;
const SKIP_SECONDS = 15;
const PAUSED_EASE_MS = 200;

// The buttons the player row can show, in the order of the setting.
const PLAYER_BUTTONS = {
    'shuffle': {icon: 'media-playlist-shuffle-symbolic', style: 'bn-toggle', press: p => p.toggleShuffle()},
    'previous': {icon: 'media-skip-backward-symbolic', press: p => p.previous()},
    'back-15': {icon: 'media-seek-backward-symbolic', press: p => p.skip(-SKIP_SECONDS)},
    'play-pause': {icon: 'media-playback-start-symbolic', style: 'bn-play', press: p => p.playPause()},
    'forward-15': {icon: 'media-seek-forward-symbolic', press: p => p.skip(SKIP_SECONDS)},
    'next': {icon: 'media-skip-forward-symbolic', press: p => p.next()},
    'repeat': {icon: 'media-playlist-repeat-symbolic', style: 'bn-toggle', press: p => p.cycleLoop()},
};
const TIMER_PRESETS = [1, 5, 10, 15, 25];
const TIMER_MODES = [
    {id: 'timer', label: 'Timer'},
    {id: 'stopwatch', label: 'Stopwatch'},
    {id: 'pomodoro', label: 'Pomodoro'},
];

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
    Signals: {
        'tab-selected': {param_types: [GObject.TYPE_STRING]},
        'battery-clicked': {},
    },
}, class Header extends St.BoxLayout {
    _init(battery, dndSettings, openPreferences, settings) {
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

        // Volume and brightness changes while the notch is open show here,
        // in place of the GNOME popup.
        this._hud = new St.BoxLayout({style_class: 'bn-header-hud', visible: false});
        this._hudIcon = new St.Icon({style_class: 'bn-header-hud-icon', y_align: Clutter.ActorAlign.CENTER});
        this._hudBar = new BarLevel.BarLevel({style_class: 'bn-hud-bar', y_align: Clutter.ActorAlign.CENTER});
        this._hud.add_child(this._hudIcon);
        this._hud.add_child(this._hudBar);
        this.add_child(this._hud);

        // Do Not Disturb is show-banners with banners stopped, bound the
        // same inverted way as GNOME's quick settings toggle, so changes
        // made anywhere update the button.
        this._dnd = new St.Button({
            style_class: 'bn-button bn-header-button bn-toggle',
            child: new St.Icon({icon_name: 'notifications-disabled-symbolic'}),
            can_focus: true,
            toggle_mode: true,
        });
        dndSettings.bind('show-banners', this._dnd, 'checked',
            Gio.SettingsBindFlags.INVERT_BOOLEAN);
        this.add_child(this._dnd);

        this._gear = iconButton('emblem-system-symbolic', 'bn-header-button', openPreferences);
        this.add_child(this._gear);

        this._batteryBox = new St.BoxLayout({style_class: 'bn-header-battery'});
        this._batteryLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER});
        this._batteryIcon = new St.Icon({style_class: 'bn-header-battery-icon'});
        this._batteryBox.add_child(this._batteryLabel);
        this._batteryBox.add_child(this._batteryIcon);
        // A click opens the battery details, when the setting allows it.
        this._batteryButton = new St.Button({
            style_class: 'bn-header-battery-button',
            can_focus: true,
            child: this._batteryBox,
        });
        this._batteryButton.connect('clicked', () => this.emit('battery-clicked'));
        settings.bind('battery-details', this._batteryButton, 'reactive', Gio.SettingsBindFlags.GET);
        this.add_child(this._batteryButton);

        battery.connectObject('changed', () => this._syncBattery(), this);
        this._syncBattery();
        this.connect('destroy', () => this._clearHudTimeout());
    }

    // Returns false for changes without a level, such as Caps Lock.
    showHud(icon, level, maxLevel) {
        if (typeof level !== 'number')
            return false;
        const max = maxLevel > 0 ? maxLevel : 1;
        this._hudIcon.gicon = icon;
        this._hudBar.maximum_value = max;
        this._hudBar.overdrive_start = 1;
        this._hudBar.value = Math.max(0, Math.min(level, max));
        this._hud.show();
        this._gear.hide();
        this._batteryButton.hide();
        this._clearHudTimeout();
        this._hudTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, HEADER_HUD_MS, () => {
            this._hudTimeoutId = 0;
            this._hud.hide();
            this._gear.show();
            this._syncBattery();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    }

    _clearHudTimeout() {
        if (this._hudTimeoutId)
            GLib.source_remove(this._hudTimeoutId);
        this._hudTimeoutId = 0;
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
        this._batteryButton.visible = this._battery.present && !this._hud.visible;
        this._batteryLabel.text = `${this._battery.percentage}%`;
        this._batteryIcon.icon_name = this._battery.iconName;
    }
});

/** The music player from NotchHomeView. */
const MediaPlayer = GObject.registerClass(
class MediaPlayer extends St.BoxLayout {
    _init(settings) {
        super._init({style_class: 'bn-player', x_expand: true, y_expand: true});

        // The cover, with a blurred enlarged copy glowing behind it while
        // the track plays; paused, the cover itself shrinks and dims.
        this._artBox = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        // A blurred, enlarged copy of the cover glows around the cover;
        // it is faint and bigger than the cover, about its centre.
        this._glow = new St.Widget({
            style_class: 'bn-art-glow',
            visible: false,
            opacity: 128,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._glow.add_effect(new Shell.BlurEffect({radius: 40, mode: Shell.BlurMode.ACTOR}));
        this._art = new AlbumArt('bn-art');
        this._artBox.add_child(this._glow);
        this._artBox.add_child(this._art);
        this._artBox.connect('button-press-event', () => {
            this._player?.raise();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._artBox);

        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-player-column',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(column);

        this._title = new MarqueeLabel('bn-title');
        this._artist = new MarqueeLabel('bn-artist');
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

        this._controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        column.add_child(this._controls);
        this._settings = settings;
        this._buttons = {};
        this._scrollOpen = false;
        this._playing = null;
        settings.connectObject(
            'changed::player-buttons', () => this._buildControls(),
            'changed::scroll-titles', () => this._syncScrolling(),
            'changed::art-glow', () => {
                this._playing = null;
                this._syncPlaying(this._player?.playing ?? false);
            },
            this);
        this._buildControls();

        this.dragging = false;
    }

    _buildControls() {
        this._controls.destroy_all_children();
        this._buttons = {};
        for (const id of this._settings.get_strv('player-buttons')) {
            const spec = PLAYER_BUTTONS[id];
            if (!spec || this._buttons[id])
                continue;
            this._buttons[id] = iconButton(spec.icon, spec.style ?? '', () => {
                if (this._player)
                    spec.press(this._player);
            });
            this._controls.add_child(this._buttons[id]);
        }
        if (this._player)
            this._syncButtons(this._player);
    }

    update(player, artUri) {
        this._player = player;
        this._art.set_art(artUri);
        this._glow.style = artUri ? `background-image: url("${artUri}");` : null;
        this._title.set(player.title);
        this._artist.set(player.artists || player.identity);
        this._slider.reactive = player.canSeek;
        this._syncButtons(player);
        this._syncPlaying(player.playing);
        this.tick();
    }

    // The glow shows while the track plays; paused, the cover eases to a
    // smaller, dimmed copy. Both animate only here, on a state change.
    _syncPlaying(playing) {
        if (playing === this._playing)
            return;
        this._playing = playing;
        this._glow.visible = playing && this._settings.get_boolean('art-glow');
        this._art.ease({
            scale_x: playing ? 1.0 : 0.85,
            scale_y: playing ? 1.0 : 0.85,
            opacity: playing ? 255 : 153,
            duration: PAUSED_EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _syncButtons(player) {
        const b = this._buttons;
        if (b['play-pause']) {
            b['play-pause'].child.icon_name = player.playing
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
        }
        if (b.previous)
            b.previous.reactive = player.canGoPrevious;
        if (b.next)
            b.next.reactive = player.canGoNext;
        for (const id of ['back-15', 'forward-15']) {
            if (b[id])
                b[id].reactive = player.canSeek;
        }
        if (b.shuffle)
            this._setChecked(b.shuffle, player.shuffle);
        if (b.repeat) {
            this._setChecked(b.repeat, player.loopStatus !== 'None');
            b.repeat.child.icon_name = player.loopStatus === 'Track'
                ? 'media-playlist-repeat-song-symbolic'
                : 'media-playlist-repeat-symbolic';
        }
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

    // Long titles scroll while the notch is open on Home, and never while
    // the notch is closed or the page is parked, however wide they are.
    setScrolling(active) {
        this._scrollOpen = active;
        this._syncScrolling();
    }

    _syncScrolling() {
        const on = this._scrollOpen && this._settings.get_boolean('scroll-titles');
        for (const label of [this._title, this._artist])
            label.setScrolling(on);
    }

    // The cover's colour tints the secondary text and the played part of
    // the seek bar; null takes the stylesheet's colours back. The active
    // fill is a style property of BarLevel, the class under the slider, so
    // a plain inline style is enough.
    setColor(rgb) {
        const color = rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : null;
        for (const label of [this._artist, this._elapsed, this._remaining])
            label.style = color ? `color: ${color};` : null;
        this._slider.style = color
            ? `-barlevel-active-background-color: ${color};`
            : null;
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
        this._next = new St.Label({style_class: 'bn-idle-next', x_align: Clutter.ActorAlign.CENTER, visible: false});
        this._next.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(this._time);
        this.add_child(this._date);
        this.add_child(this._next);
        this.add_child(hint);
        this.tick();
    }

    // `next` is the event to name under the date, or null for none.
    tick(next = null) {
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format('%H:%M');
        this._date.text = now.format('%A, %e %B').replace(/\s+/g, ' ');
        this._next.visible = next !== null;
        if (next) {
            const start = GLib.DateTime.new_from_unix_local(next.date.getTime() / 1000);
            this._next.text = `Up next  ${start.format('%H:%M')}  ${next.summary}`;
        }
    }
});

/**
 * The Today tab, like GNOME's top bar calendar menu: notifications on the
 * left, the month and the selected day's events on the right. Both widgets
 * are GNOME's own, so grouping, dismissing and event loading behave the same.
 */
const TodayView = GObject.registerClass(
class TodayView extends St.BoxLayout {
    _init(settings) {
        super._init({style_class: 'bn-today', x_expand: true, y_expand: true});
        this.layout_manager.homogeneous = true;
        this._settings = settings;
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
            this);
        this.connect('destroy', () => {
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

/** The Timer tab: a countdown with presets, a stopwatch or a Pomodoro, then
 *  start, pause and reset. Starting one mode stops the others. */
const TimerView = GObject.registerClass(
class TimerView extends St.BoxLayout {
    _init({settings, timer, stopwatch, pomodoro}) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-timer',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._settings = settings;
        this._models = {timer, stopwatch, pomodoro};
        this._selected = 'timer';
        this._minutes = 5;

        this._time = new St.Label({style_class: 'bn-timer-time', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._time);

        const modes = new St.BoxLayout({style_class: 'bn-timer-presets', x_align: Clutter.ActorAlign.CENTER});
        this._modeChips = TIMER_MODES.map(({id, label}) => {
            const button = new St.Button({style_class: 'bn-chip', label, can_focus: true});
            button.connect('clicked', () => {
                this._selected = id;
                this._sync();
            });
            button._mode = id;
            modes.add_child(button);
            return button;
        });
        this._modeRow = modes;
        this.add_child(modes);

        const presets = new St.BoxLayout({style_class: 'bn-timer-presets', x_align: Clutter.ActorAlign.CENTER});
        this._presets = TIMER_PRESETS.map(minutes => {
            const button = new St.Button({style_class: 'bn-chip', label: `${minutes} min`, can_focus: true});
            button.connect('clicked', () => {
                this._minutes = minutes;
                this._start();
            });
            button._minutes = minutes;
            presets.add_child(button);
            return button;
        });
        this._presetRow = presets;
        this.add_child(presets);

        this._phase = new St.Label({style_class: 'bn-timer-phase', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._phase);

        const controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        this._playPause = iconButton('media-playback-start-symbolic', 'bn-play', () => {
            const model = this._model;
            if (model.running)
                model.pause();
            else if (model.active)
                model.resume();
            else
                this._start();
        });
        this._reset = iconButton('view-refresh-symbolic', '', () => this._model.reset());
        controls.add_child(this._playPause);
        controls.add_child(this._reset);
        this.add_child(controls);

        for (const model of Object.values(this._models))
            model.connectObject('changed', () => this._sync(), this);
        settings.connectObject('changed', () => this._sync(), this);
        this._sync();
    }

    // Only the countdown while the modes are switched off in the settings.
    get _mode() {
        return this._settings.get_boolean('timer-modes') ? this._selected : 'timer';
    }

    get _model() {
        return this._models[this._mode];
    }

    // Starting one mode resets the others, wherever the start comes from.
    _start() {
        if (this._mode === 'timer')
            this._models.timer.start(this._minutes * 60);
        else
            this._model.start();
    }

    // What the time reads when nothing runs: the chosen countdown, the
    // Pomodoro's work length, or zero for the stopwatch.
    _idleSeconds() {
        if (this._mode === 'timer')
            return this._minutes * 60;
        if (this._mode === 'pomodoro')
            return this._settings.get_int('pomodoro-work-minutes') * 60;
        return 0;
    }

    _sync() {
        const mode = this._mode;
        const model = this._model;
        this._time.text = formatSeconds(model.active ? model.seconds : this._idleSeconds());
        this._playPause.child.icon_name = model.running
            ? 'media-playback-pause-symbolic'
            : 'media-playback-start-symbolic';
        this._reset.reactive = model.active;

        this._modeRow.visible = this._settings.get_boolean('timer-modes');
        for (const button of this._modeChips) {
            if (button._mode === mode)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }

        this._presetRow.visible = mode === 'timer';
        const selected = model.active ? Math.round(this._models.timer.duration / 60) : this._minutes;
        for (const button of this._presets) {
            if (button._minutes === selected)
                button.add_style_pseudo_class('checked');
            else
                button.remove_style_pseudo_class('checked');
        }
        this._phase.visible = mode === 'pomodoro';
        if (mode === 'pomodoro')
            this._phase.text = model.phase === 'break' ? 'Break' : 'Work';
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
    _init({settings, battery, timer, stopwatch, pomodoro, dndSettings, openPreferences}) {
        super._init({style_class: 'bn-open', opacity: 0});
        this._settings = settings;

        this._header = new Header(battery, dndSettings, openPreferences, settings);
        this._header.connect('tab-selected', (_h, id) => this.emit('tab-selected', id));
        this._header.connect('battery-clicked', () => this._toggleBatteryPanel());
        this.add_child(this._header);

        this._player = new MediaPlayer(settings);
        this._idle = new IdleView();
        const home = new St.Widget({layout_manager: new Clutter.BinLayout()});
        home.add_child(this._player);
        home.add_child(this._idle);
        this._today = new TodayView(settings);
        this._pages = {home, today: this._today, timer: new TimerView({settings, timer, stopwatch, pomodoro})};
        Object.values(this._pages).forEach(page => this.add_child(page));
        this._batteryPanel = new BatteryPanel(battery);
        this.add_child(this._batteryPanel);

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
        this._batteryPanel.hide();
        // Titles only scroll while their page is in view.
        this._player.setScrolling(id === 'home');
        if (id === 'today')
            this._today.reset();
    }

    setUnread(unread) {
        this._header.setUnread(unread);
    }

    setColor(rgb) {
        this._player.setColor(rgb);
    }

    showHud(icon, level, maxLevel) {
        return this._header.showHud(icon, level, maxLevel);
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
        this._layoutBatteryPanel();
    }

    _layoutHeader() {
        if (!this._sizes)
            return;
        const [width] = this._sizes[this._tab];
        this._header.set_position(0, 0);
        this._header.set_size(width, this._headerHeight);
    }

    // The battery panel covers the page under the header, as the page does.
    _layoutBatteryPanel() {
        if (!this._sizes)
            return;
        const [width, height] = this._sizes[this._tab];
        this._batteryPanel.set_position(0, this._headerHeight);
        this._batteryPanel.set_size(width, Math.max(0, height - this._headerHeight));
    }

    _toggleBatteryPanel() {
        if (this._batteryPanel.visible) {
            this._batteryPanel.hide();
        } else {
            this._layoutBatteryPanel();
            this._batteryPanel.open();
        }
    }

    closeBatteryPanel() {
        this._batteryPanel.hide();
    }

    get eventSource() {
        return this._today.eventSource;
    }

    // The Today tab's month is the range the shell's events are loaded for,
    // so it goes back to today's month when the notch closes.
    resetToday() {
        this._today.reset();
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
        this._player.setScrolling(this._tab === 'home');
    }

    stopTicking() {
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        this._player.setScrolling(false);
    }

    _tick() {
        if (!this._pages.home.visible)
            return;
        if (this._player.visible)
            this._player.tick();
        else
            this._idle.tick(this._settings.get_boolean('up-next') ? this._today.nextEvent() : null);
    }
});
