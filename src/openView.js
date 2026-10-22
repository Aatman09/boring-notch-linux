import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {BatteryPanel} from './batteryPanel.js';
import {Header} from './header.js';
import {IdleView, MediaPlayer} from './player.js';
import {ShelfView} from './shelfView.js';
import {TimerView} from './timerView.js';
import {TodayView} from './todayView.js';

const TICK_MS = 500;

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
    _init({settings, weather, battery, timer, stopwatch, pomodoro, shelf, clipboard, dndSettings, openPreferences}) {
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
        this._today = new TodayView(settings, weather);
        this._weather = weather;
        this._pages = {
            home,
            today: this._today,
            timer: new TimerView({settings, timer, stopwatch, pomodoro}),
            shelf: new ShelfView({settings, shelf, clipboard}),
        };
        Object.values(this._pages).forEach(page => this.add_child(page));
        this._tab = 'home';
        this._batteryPanel = new BatteryPanel(battery);
        this.add_child(this._batteryPanel);

        this._sizes = null;
        this.update(null, null);
        this.setTab('home');
        this.connect('destroy', () => this.stopTicking());
    }

    setTab(id) {
        this._showBatteryPanel(false);
        this._tab = id;
        for (const [pageId, page] of Object.entries(this._pages))
            page.translation_y = pageId === id ? 0 : PARKED_Y;
        this._header.setActiveTab(id);
        this._layoutHeader();
        // Titles only scroll while their page is in view.
        this._player.setScrolling(id === 'home');
        if (id === 'today') {
            this._today.reset();
            this._weather.refresh();
        }
        if (id === 'shelf')
            this._pages.shelf.reset();
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
        this._showBatteryPanel(!this._batteryPanel.visible);
    }

    closeBatteryPanel() {
        this._showBatteryPanel(false);
    }

    // The panel is drawn over the page, which fades out under it: the
    // cover's glow would otherwise show around the panel's edges.
    _showBatteryPanel(show) {
        if (show) {
            this._layoutBatteryPanel();
            this._batteryPanel.open();
        } else {
            this._batteryPanel.hide();
        }
        this._pages[this._tab].opacity = show ? 0 : 255;
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
