import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {BatterySneakView, IconTextView, InlineHudView, LiveMediaView} from './closedViews.js';
import {NotchShape} from './notchShape.js';
import {OpenView} from './openView.js';
import {Spring, SpringAnimator} from './spring.js';
import {formatTime} from './widgets.js';

const formatSeconds = s => formatTime(s * GLib.USEC_PER_SEC);

// Sizes and springs from boring.notch (sizing/matters.swift and
// ContentView.swift), in logical pixels and seconds, before the size
// setting is applied. The Today tab is larger to fit the calendar.
const OPEN_SIZES = {
    home: {width: 640, height: 190},
    today: {width: 820, height: 460},
    timer: {width: 640, height: 190},
};
const RADII = {
    open: {top: 19, bottom: 24},
    closed: {top: 6, bottom: 14},
};
const OPEN_PADDING = 12;
const OPEN_SPRING = {response: 0.42, damping: 0.8};
const CLOSE_SPRING = {response: 0.45, damping: 1.0};
const RESIZE_SPRING = {response: 0.38, damping: 0.8};
// The closed notch grows a little under the pointer, hinting it can open.
const HOVER_GROWTH = {width: 12, height: 4};
const FALLBACK_PANEL_HEIGHT = 32;

const CLOSE_DELAY_MS = 100;
const HUD_TIMEOUT_MS = 1500;
const BATTERY_TIMEOUT_MS = 2500;
const NOTIFICATION_TIMEOUT_MS = 4000;
const DOWNLOAD_TIMEOUT_MS = 4000;
const TIMER_DONE_TIMEOUT_MS = 6000;
const PAUSE_LINGER_MS = 3000;
const FADE_MS = 150;
// Room on each side of the clock, in design pixels.
const CLOCK_PADDING = 16;
// Where the open content waits while the notch is closed: laid out and
// styled, so opening does not stall on the first frame, but clipped away.
const PARKED_Y = -10000;

const State = {CLOSED: 'closed', OPEN: 'open'};

export const Island = GObject.registerClass(
class Island extends St.Widget {
    _init({settings, zoom, media, battery, timer, downloads, audio, artCache, openPreferences}) {
        super._init({
            name: 'boring-notch',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
        });

        this._settings = settings;
        this._zoomSource = zoom;
        this._media = media;
        this._battery = battery;
        this._timer = timer;
        this._downloads = downloads;
        this._artCache = artCache;
        this._state = State.CLOSED;
        this._tab = 'home';
        this._sneak = null;
        this._sneakAction = null;
        this._showMedia = false;
        this._artUrl = null;
        this._artUri = null;
        this._timeouts = new Map();

        // Children are placed by hand: the content keeps a fixed size and
        // is moved with a translation while the notch grows around it, so
        // nothing has to be laid out again on each frame.
        this._shape = new NotchShape();
        this.add_child(this._shape);

        this._closedLayer = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._closedHalf = 0;
        this._openHalf = 0;
        this.add_child(this._closedLayer);

        // The top bar clock, when it lives in the notch. It sits behind the
        // live activities, in the empty middle they leave.
        this._clockBox = new St.BoxLayout({
            style_class: 'bn-clock-box',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockLabel = new St.Label({style_class: 'bn-clock', y_align: Clutter.ActorAlign.CENTER});
        this._unreadDot = new St.Widget({style_class: 'bn-unread-dot', y_align: Clutter.ActorAlign.CENTER});
        this._clockBox.add_child(this._clockLabel);
        this._clockBox.add_child(this._unreadDot);
        this._closedLayer.add_child(this._clockBox);
        this._wallClock = new GnomeDesktop.WallClock();
        this._wallClock.bind_property('clock', this._clockLabel, 'text', GObject.BindingFlags.SYNC_CREATE);

        this._liveMedia = new LiveMediaView(audio);
        this._hud = new InlineHudView();
        this._batterySneak = new BatterySneakView();
        this._timerLive = new IconTextView('bn-timer-live', 52);
        this._downloadLive = new IconTextView('bn-download-live', 52);
        this._messageSneak = new IconTextView('bn-message-sneak', 150, {peek: true});
        [this._liveMedia, this._hud, this._batterySneak, this._timerLive,
            this._downloadLive, this._messageSneak]
            .forEach(v => this._closedLayer.add_child(v));
        this._closedView = null;

        this._openView = new OpenView({
            battery,
            timer,
            openPreferences: () => {
                this.close();
                openPreferences();
            },
        });
        this._openView.connect('tab-selected', (_v, tab) => this.open(tab));
        this._openView.translation_y = PARKED_Y;
        this.add_child(this._openView);

        const r = RADII.closed;
        this._width = new Spring(settings.get_int('closed-width'));
        this._height = new Spring(FALLBACK_PANEL_HEIGHT);
        this._topRadius = new Spring(r.top);
        this._bottomRadius = new Spring(r.bottom);
        this._springs = [this._width, this._height, this._topRadius, this._bottomRadius];
        this._animator = new SpringAnimator(this, this._springs, () => this._applyGeometry());

        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('button-press-event', () => {
            if (this._state !== State.CLOSED)
                return Clutter.EVENT_PROPAGATE;
            if (this._sneakAction) {
                const action = this._sneakAction;
                this._endSneak();
                action();
            } else {
                this.open();
            }
            return Clutter.EVENT_STOP;
        });

        settings.connectObject(
            'changed::closed-width', () => this._relayout(),
            'changed::clock-mode', () => this._syncClock(),
            'changed::show-visualizer', () => this._syncVisualizer(),
            'changed::visualizer-follows-audio', () => this._syncVisualizer(),
            'changed::show-downloads', () => this._relayout(),
            this);
        zoom.connectObject('changed', () => this._relayout(true), this);
        this._clockLabel.connect('notify::text', () => this._relayout());
        media.connectObject('changed', () => this._syncMedia(), this);
        battery.connectObject('plugged', () => this._onPlugged(), this);
        timer.connectObject(
            'changed', () => this._syncTimer(),
            'finished', () => this._onTimerFinished(),
            this);
        downloads.connectObject(
            'changed', () => this._syncDownloads(),
            'finished', (_d, file) => this._onDownloadFinished(file),
            this);
        Main.layoutManager.connectObject('monitors-changed', () => this._relayout(true), this);
        Main.panel.connectObject('notify::height', () => this._relayout(true), this);
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        themeContext.connectObject('notify::scale-factor', () => this._relayout(true), this);

        // The top bar's own unread indicator tells us whether there are
        // notifications waiting; it keeps working while the clock is hidden.
        this._indicator = Main.panel.statusArea.dateMenu?._indicator ?? null;
        this._indicator?.connectObject('notify::visible', () => this._syncUnread(), this);

        this.connect('parent-set', () => this._relayout(true));
        this.connect('destroy', () => this._onDestroy());

        this._syncClock();
        this._syncUnread();
        this._syncMedia();
        this._syncTimer();
        this._syncDownloads();
        this._relayout(true);
    }

    get monitorIndex() {
        return Main.layoutManager.primaryIndex;
    }

    get _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    get _zoom() {
        return this._zoomSource.value;
    }

    // The closed notch is as tall as the top bar, like boring.notch's
    // "match menu bar" height on Macs without a notch.
    get _notchHeight() {
        const height = Main.panel.height / this._scale;
        return height > 0 ? height : FALLBACK_PANEL_HEIGHT;
    }

    open(tab = this._tab) {
        const opening = this._state !== State.OPEN;
        if (!opening && tab === this._tab)
            return;
        this._tab = tab;
        this._openView.setTab(tab);
        this._clearTimeout('hover');

        if (opening) {
            this._state = State.OPEN;
            this._endSneak(false);
            this._fade(this._closedLayer, false);
            this._showOpenView(true);
            this._openView.startTicking();
            this._syncVisualizer();
            this._springs.forEach(s => s.configure(OPEN_SPRING));
        } else {
            this._springs.forEach(s => s.configure(RESIZE_SPRING));
        }
        this._relayout();
    }

    close() {
        if (this._state === State.CLOSED)
            return;
        this._state = State.CLOSED;
        this._clearTimeout('hover');

        this._showOpenView(false);
        this._fade(this._closedLayer, true, FADE_MS);
        this._openView.stopTicking();
        this._syncVisualizer();
        this._springs.forEach(s => s.configure(CLOSE_SPRING));
        this._relayout();
    }

    // For the notification shortcut (Super+V).
    toggle(tab) {
        if (this._state === State.OPEN && this._tab === tab)
            this.close();
        else
            this.open(tab);
    }

    /**
     * Shows a volume or brightness change in the closed notch. Returns false
     * when the notch is open, so the caller can fall back to the GNOME popup.
     */
    showHud(icon, label, level, maxLevel) {
        if (this._state === State.OPEN || !this.visible)
            return false;
        this._hud.update(icon, label, level, maxLevel);
        this._showSneak(this._hud, HUD_TIMEOUT_MS);
        return true;
    }

    /**
     * Shows a new notification as a peek; clicking it opens the
     * notification. Returns false when the notch cannot show it, so the
     * caller can fall back to a GNOME banner.
     */
    showNotification(notification) {
        if (this._state === State.OPEN || !this.visible)
            return false;
        this._messageSneak.update({
            icon: notification.gicon ?? notification.source?.icon ?? null,
            iconName: 'preferences-system-notifications-symbolic',
            title: notification.title ?? '',
            body: (notification.body ?? '').replace(/\s+/g, ' '),
        });
        this._showSneak(this._messageSneak, NOTIFICATION_TIMEOUT_MS, () => notification.activate());
        return true;
    }

    _onPlugged() {
        if (!this._settings.get_boolean('show-battery-activity') || this._state === State.OPEN)
            return;
        this._batterySneak.update(this._battery);
        this._showSneak(this._batterySneak, BATTERY_TIMEOUT_MS);
    }

    _onTimerFinished() {
        global.display.get_sound_player().play_from_theme('complete', 'Timer done', null);
        if (this._state === State.OPEN)
            return;
        this._timerLive.update({iconName: 'alarm-symbolic', title: 'Done'});
        this._showSneak(this._timerLive, TIMER_DONE_TIMEOUT_MS, () => this.open('timer'));
    }

    _onDownloadFinished(file) {
        if (!this._settings.get_boolean('show-downloads') || this._state === State.OPEN)
            return;
        this._messageSneak.update({
            iconName: 'folder-download-symbolic',
            title: 'Downloaded',
            body: file.get_basename(),
        });
        this._showSneak(this._messageSneak, DOWNLOAD_TIMEOUT_MS, () => {
            const folder = this._downloads.folder?.get_uri();
            if (folder)
                Gio.AppInfo.launch_default_for_uri(folder, global.create_app_launch_context(0, -1));
        });
    }

    _showSneak(view, timeout, action = null) {
        this._sneak = view;
        this._sneakAction = action;
        this._setTimeout('sneak', timeout, () => this._endSneak());
        this._relayout();
    }

    _endSneak(relayout = true) {
        this._clearTimeout('sneak');
        this._sneak = null;
        this._sneakAction = null;
        // The timer view doubles as its own "done" peek; put it back.
        this._syncTimer();
        if (relayout)
            this._relayout();
    }

    _syncTimer() {
        if (this._sneak === this._timerLive)
            return;
        this._timerLive.update({
            iconName: 'alarm-symbolic',
            title: formatSeconds(this._timer.remaining),
        });
        this._relayout();
    }

    _syncDownloads() {
        const count = this._downloads.count;
        this._downloadLive.update({
            iconName: 'folder-download-symbolic',
            title: count > 1 ? `${count}` : '',
        });
        this._relayout();
    }

    get _clockInNotch() {
        return this._settings.get_string('clock-mode') === 'notch';
    }

    _syncClock() {
        this._relayout();
    }

    _showClock(show) {
        if (show === this._clockShown)
            return;
        this._clockShown = show;
        this._fade(this._clockBox, show, show ? FADE_MS / 2 : 0);
    }

    _syncUnread() {
        const unread = !!this._indicator?.visible;
        this._unreadDot.visible = unread;
        this._openView.setUnread(unread);
    }

    _syncMedia() {
        const player = this._media.activePlayer;

        // Like boring.notch, keep the live activity up for a moment after
        // playback pauses, so a quick pause does not make the notch jump.
        if (player?.playing) {
            this._clearTimeout('linger');
            this._showMedia = true;
        } else if (!player) {
            this._clearTimeout('linger');
            this._showMedia = false;
        } else if (this._showMedia && !this._timeouts.has('linger')) {
            this._setTimeout('linger', PAUSE_LINGER_MS, () => {
                this._showMedia = !!this._media.activePlayer?.playing;
                this._relayout();
            });
        }

        this._syncArt(player);
        this._liveMedia.update(this._artUri);
        this._syncVisualizer();
        this._openView.update(player, this._artUri);
        this._relayout();
    }

    _syncArt(player) {
        const url = player?.artUrl ?? null;
        if (url === this._artUrl)
            return;
        this._artUrl = url;
        this._artUri = null;
        this._artCache.resolve(url, uri => {
            // Ignore answers for a track that is no longer playing.
            if (this._artUrl !== url || !this._artCache)
                return;
            this._artUri = uri;
            this._liveMedia.update(uri);
            this._openView.update(this._media.activePlayer, uri);
        });
    }

    // Peeks first, then live activities in order of how much they matter
    // right now.
    _currentClosedView() {
        if (this._sneak)
            return this._sneak;
        if (this._timer.active)
            return this._timerLive;
        if (this._downloads.count > 0 && this._settings.get_boolean('show-downloads'))
            return this._downloadLive;
        if (this._showMedia)
            return this._liveMedia;
        return null;
    }

    _onHoverChanged() {
        this._clearTimeout('hover');

        if (this.hover && this._state === State.CLOSED) {
            if (this._settings.get_boolean('open-on-hover'))
                this._setTimeout('hover', this._settings.get_int('hover-delay'), () => this.open());
        } else if (!this.hover && this._state === State.OPEN) {
            this._setTimeout('hover', CLOSE_DELAY_MS, () => {
                // Keep the notch open while the seek bar is being dragged.
                if (!this.hover && !this._openView.busy)
                    this.close();
            });
        }

        this._relayout();
    }

    // Works out the size the notch should spring towards. With `jump` the
    // notch moves there at once, for screen and scale changes.
    _relayout(jump = false) {
        if (!this._springs)
            return;
        const notchHeight = this._notchHeight;
        const zoom = this._zoom;
        const scale = this._scale;
        let width, height, radii;

        if (this._state === State.OPEN) {
            const size = OPEN_SIZES[this._tab];
            width = size.width * zoom;
            height = size.height * zoom;
            radii = RADII.open;
        } else {
            const view = this._currentClosedView();
            const showClock = this._clockInNotch && (!view || view.showsClock);
            let middle = this._settings.get_int('closed-width');
            // The clock can only be measured once it is on the stage.
            if (showClock && this.get_stage()) {
                const [, clockWidth] = this._clockBox.get_preferred_width(-1);
                middle = Math.max(middle, clockWidth / scale / zoom + 2 * CLOCK_PADDING);
            }
            width = (middle + 2 * (view?.sideWidth(notchHeight) ?? 0)) * zoom;
            height = notchHeight;
            radii = RADII.closed;
            if (this.hover && !view) {
                width += HOVER_GROWTH.width * zoom;
                height += HOVER_GROWTH.height * zoom;
            }
            this._showClosedView(view);
            this._showClock(showClock);

            // The closed content is laid out at the notch's final width.
            this._closedHalf = this._snap(width / 2) * scale;
            this._closedLayer.set_size(2 * this._closedHalf, notchHeight * scale);
        }

        // Every tab's page always has its size, even while parked, so it is
        // laid out before it is needed.
        const inset = (RADII.open.top + OPEN_PADDING) * zoom;
        const contentSizes = {};
        for (const [tab, size] of Object.entries(OPEN_SIZES)) {
            contentSizes[tab] = [
                this._snap(size.width * zoom - 2 * inset) * scale,
                this._snap((size.height - OPEN_PADDING) * zoom) * scale,
            ];
        }
        this._openView.setGeometry(contentSizes, notchHeight * scale);
        this._openHalf = contentSizes[this._tab][0] / 2;

        this._width.target = width * scale;
        this._height.target = height * scale;
        this._topRadius.target = radii.top * zoom * scale;
        this._bottomRadius.target = radii.bottom * zoom * scale;

        // Moving between closed views is a resize, not an open or close.
        if (this._state === State.CLOSED && this._width.atRest && this._height.atRest)
            this._springs.forEach(s => s.configure(RESIZE_SPRING));

        if (jump) {
            this._springs.forEach(s => s.snap());
            this._applyGeometry();
        } else {
            this._animator.start();
        }
    }

    _showClosedView(view) {
        if (view === this._closedView)
            return;
        if (this._closedView)
            this._fade(this._closedView, false);
        if (view)
            this._fade(view, true, FADE_MS / 2);
        this._closedView = view;
        this._syncVisualizer();
    }

    // The bars, and the audio capture behind them, only run while they
    // can be seen.
    _syncVisualizer() {
        const visible = this._state === State.CLOSED && this._closedView === this._liveMedia;
        const playing = !!this._media.activePlayer?.playing;
        this._liveMedia.setAnimating(
            visible && playing && this._settings.get_boolean('show-visualizer'),
            this._settings.get_boolean('visualizer-follows-audio'));
    }

    _showOpenView(show) {
        const view = this._openView;
        view.remove_transition('opacity');
        if (show)
            view.translation_y = 0;
        view.ease({
            opacity: show ? 255 : 0,
            delay: show ? FADE_MS / 2 : 0,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: isFinished => {
                if (isFinished && !show)
                    view.translation_y = PARKED_Y;
            },
        });
    }

    // Device pixels per logical pixel: 1.25 at 125% fractional scaling.
    get _deviceScale() {
        const views = global.stage.peek_stage_views();
        return Math.max(1, ...views.map(v => v.get_scale()));
    }

    // Rounds to whole device pixels. At fractional scales a logical pixel
    // is not a device pixel, and anything placed between device pixels
    // looks soft.
    _snap(value) {
        const device = this._deviceScale;
        return Math.round(value * device) / device;
    }

    _applyGeometry() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        // Grow out from the middle of the screen by the same snapped amount
        // on both sides, so the notch stays centred and on the pixel grid.
        const half = Math.max(1, this._snap(this._width.value / 2));
        const height = Math.max(1, this._snap(this._height.value));
        const middle = this._snap(monitor.x + monitor.width / 2);
        this.set_size(2 * half, height);
        this.set_position(middle - half, monitor.y);
        this._shape.setGeometry(2 * half, height,
            this._topRadius.value, this._bottomRadius.value, this._scale);

        // Content stays centred on the screen while the notch grows.
        this._closedLayer.translation_x = half - this._closedHalf;
        this._openView.translation_x = half - this._openHalf;
    }

    _fade(actor, visible, delay = 0) {
        actor.remove_transition('opacity');
        if (visible)
            actor.show();
        actor.ease({
            opacity: visible ? 255 : 0,
            delay,
            duration: FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: isFinished => {
                if (isFinished && !visible)
                    actor.hide();
            },
        });
    }

    _setTimeout(name, ms, callback) {
        this._clearTimeout(name);
        this._timeouts.set(name, GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            this._timeouts.delete(name);
            callback();
            return GLib.SOURCE_REMOVE;
        }));
    }

    _clearTimeout(name) {
        const id = this._timeouts.get(name);
        if (id) {
            GLib.source_remove(id);
            this._timeouts.delete(name);
        }
    }

    _onDestroy() {
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._timeouts.clear();
        this._animator.destroy();
        this._springs = null;
        this._indicator?.disconnectObject(this);
        this._wallClock = null;
        this._artCache = null;
    }
});
