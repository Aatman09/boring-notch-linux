import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GnomeDesktop from 'gi://GnomeDesktop';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {InlineHudView, LiveMediaView, MusicPeekView, RowHudView} from './closedViews.js';
import {LiveActivities} from './liveActivities.js';
import {NotchShape} from './notchShape.js';
import {OpenView} from './openView.js';
import {PeekQueue, Priority} from './peekQueue.js';
import {Spring, SpringAnimator} from './spring.js';
import {SystemPeeks} from './systemPeeks.js';
import {VOLUME_STEP, getVolume, setBrightness, setVolume, volumeIcon} from './volume.js';

// Sizes and springs from boring.notch (sizing/matters.swift and
// ContentView.swift), in logical pixels and seconds, before the size
// setting is applied. The Today tab is larger to fit the calendar.
const OPEN_SIZES = {
    home: {width: 640, height: 190},
    today: {width: 690, height: 460},
    timer: {width: 640, height: 190},
    shelf: {width: 640, height: 190},
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
const MUSIC_PEEK_TIMEOUT_MS = 3000;
// A notch opened from the keyboard closes by itself unless the pointer
// comes to it.
const KEYBOARD_OPEN_MS = 4000;
const FADE_MS = 150;
// Room on each side of the clock, in design pixels.
const CLOCK_PADDING = 16;
// Where the open content waits while the notch is closed: laid out and
// styled, so opening does not stall on the first frame, but clipped away.
const PARKED_Y = -10000;

const State = {CLOSED: 'closed', OPEN: 'open'};

// Gestures on the notch. Touchpad deltas are summed until they pass the
// threshold; a pause longer than the gap starts a new gesture.
const SWIPE_THRESHOLD = 1.5;
const GESTURE_GAP_US = 300 * 1000;

export const Island = GObject.registerClass(
class Island extends St.Widget {
    // `sources` holds the extension's monitors and models, by name: media,
    // battery, timer, stopwatch, pomodoro, shelf, clipboard, downloads, audio, privacy,
    // bluetooth, keyboard, recording, audioRoute, artCache and artColor.
    _init({settings, zoom, sources, openPreferences}) {
        super._init({
            name: 'boring-notch',
            reactive: true,
            track_hover: true,
            clip_to_allocation: true,
        });

        const {media, audio, privacy} = sources;
        this._settings = settings;
        this._zoomSource = zoom;
        this._sources = sources;
        this._media = media;
        this._battery = sources.battery;
        this._keyboard = sources.keyboard;
        this._audioRoute = sources.audioRoute;
        this._artCache = sources.artCache;
        this._artColor = sources.artColor;
        this._state = State.CLOSED;
        this._tab = 'home';
        this._peekQueue = new PeekQueue({
            onShow: () => {
                this._syncMusicPeekScroll();
                this._relayout();
            },
            onIdle: () => {
                this._syncMusicPeekScroll();
                this._live.syncTimer();
                this._relayout();
            },
            canContinue: () => this._state === State.CLOSED,
        });
        // True while hover must wait for the pointer to leave after a press
        // on a control inside a peek.
        this._hoverHeld = false;
        this._gesture = {dx: 0, dy: 0, time: 0, done: false};
        this._soundSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.sound'});
        this._touchpadSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.peripherals.touchpad'});
        this._showMedia = false;
        this._artUrl = null;
        this._artUri = null;
        // The colour averaged from the current cover and the track it
        // belongs to, so an answer for a track that has gone is ignored.
        this._artColorRgb = null;
        this._artColorTrack = null;
        this._timeouts = new Map();

        // Children are placed by hand: the content keeps a fixed size and
        // is moved with a translation while the notch grows around it, so
        // nothing has to be laid out again on each frame.
        this._shape = new NotchShape();
        this.add_child(this._shape);

        // Each closed view keeps the width it was laid out at, and is moved
        // with a translation to stay centred. A view fading out therefore
        // keeps its layout while the notch resizes for the next one.
        this._closedLayer = new St.Widget();
        this._openHalf = 0;
        this.add_child(this._closedLayer);

        // The top bar clock, when it lives in the notch. It sits behind the
        // live activities, in the empty middle they leave.
        this._clockBox = new St.BoxLayout({
            style_class: 'bn-clock-box',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockLabel = new St.Label({style_class: 'bn-clock', y_align: Clutter.ActorAlign.CENTER});
        // Never shorten the time: the notch is sized to fit it.
        this._clockLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this._unreadDot = new St.Widget({style_class: 'bn-unread-dot', y_align: Clutter.ActorAlign.CENTER});
        this._privacyBox = new St.BoxLayout({style_class: 'bn-privacy', y_align: Clutter.ActorAlign.CENTER});
        this._privacyDots = {};
        for (const kind of ['mic', 'camera', 'sharing']) {
            const dot = new St.Widget({
                style_class: `bn-privacy-dot bn-privacy-${kind}`,
                visible: false,
                y_align: Clutter.ActorAlign.CENTER,
            });
            this._privacyDots[kind] = dot;
            this._privacyBox.add_child(dot);
        }
        this._privacyState = privacy.state;
        // Do Not Disturb is the show-banners key with banners stopped.
        this._dndSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        this._dndMoon = new St.Icon({
            icon_name: 'weather-clear-night-symbolic',
            style_class: 'bn-dnd-moon',
            visible: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._clockBox.add_child(this._clockLabel);
        this._clockBox.add_child(this._unreadDot);
        this._clockBox.add_child(this._privacyBox);
        this._clockBox.add_child(this._dndMoon);
        // The slot is as wide as the notch and the layout centres the clock
        // in it, so the clock stays centred whatever width its text or font
        // gives it, without anything having to measure it first.
        this._clockSlot = new St.Widget({layout_manager: new Clutter.BinLayout()});
        this._clockSlot.add_child(this._clockBox);
        this._closedLayer.add_child(this._clockSlot);
        this._wallClock = new GnomeDesktop.WallClock();
        this._wallClock.bind_property('clock', this._clockLabel, 'text', GObject.BindingFlags.SYNC_CREATE);

        this._liveMedia = new LiveMediaView(audio);
        this._hud = new InlineHudView(settings);
        this._hudRow = new RowHudView(settings);
        for (const hud of [this._hud, this._hudRow])
            hud.onAdjust = (kind, level, maxLevel) => this._adjustHud(kind, level, maxLevel);
        this._musicPeek = new MusicPeekView();
        this._systemPeeks = new SystemPeeks({settings, sources, dndSettings: this._dndSettings, host: this});
        [this._liveMedia, this._hud, this._hudRow, this._musicPeek, ...this._systemPeeks.views]
            .forEach(v => this._closedLayer.add_child(v));
        // The layer fading out when the notch opens takes the shown view
        // with it; let that view go of what it holds once it is hidden.
        this._closedLayer.onHidden = () => this._closedView?.onHidden();
        this._closedView = null;

        this._openView = new OpenView({
            settings,
            weather: sources.weather,
            battery: this._battery,
            timer: sources.timer,
            stopwatch: sources.stopwatch,
            pomodoro: sources.pomodoro,
            shelf: sources.shelf,
            clipboard: sources.clipboard,
            dndSettings: this._dndSettings,
            openPreferences: () => {
                this.close();
                openPreferences();
            },
        });
        this._openView.connect('tab-selected', (_v, tab) => this.open(tab));
        this._openView.translation_y = PARKED_Y;
        this.add_child(this._openView);

        // Made before the springs, so their first syncs do not lay out a
        // half-built notch.
        this._live = new LiveActivities({settings, sources, eventSource: this._openView.eventSource, host: this});
        this._live.views.forEach(v => this._closedLayer.add_child(v));

        const r = RADII.closed;
        this._width = new Spring(settings.get_int('closed-width'));
        this._height = new Spring(FALLBACK_PANEL_HEIGHT);
        this._topRadius = new Spring(r.top);
        this._bottomRadius = new Spring(r.bottom);
        this._springs = [this._width, this._height, this._topRadius, this._bottomRadius];
        this._animator = new SpringAnimator(this, this._springs, () => this._applyGeometry());

        this._menu = this._buildMenu(openPreferences);

        this.connect('notify::hover', () => this._onHoverChanged());
        this.connect('button-press-event', (_a, event) => this._onButtonPress(event));
        this.connect('scroll-event', (_a, event) => this._onScroll(event));

        settings.connectObject(
            'changed::closed-width', () => this._relayout(),
            'changed::clock-mode', () => this._syncClock(),
            'changed::show-visualizer', () => this._syncVisualizer(),
            'changed::visualizer-follows-audio', () => this._syncVisualizer(),
            'changed::art-colors', () => this._syncArtColors(),
            'changed::scroll-titles', () => this._syncMusicPeekScroll(),
            'changed::show-privacy-indicators', () => this._syncPrivacyDots(),
            'changed::show-dnd', () => this._syncMoon(),
            'changed::show-shelf', () => this._syncShelfTab(),
            this);
        zoom.connectObject('changed', () => this._relayout(true), this);
        this._clockLabel.connect('notify::text', () => this._relayout());
        // A new font changes how wide the time is.
        this._clockLabel.connect('style-changed', () => this._relayout());
        media.connectObject(
            'changed', () => this._syncMedia(),
            'track-changed', (_m, player) => this._onTrackChanged(player),
            this);
        privacy.connectObject('changed',
            (_p, state) => this._onPrivacyChanged(state), this);
        this._dndSettings.connectObject('changed::show-banners',
            () => this._syncMoon(), this);
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
        this._syncPrivacyDots();
        this._syncMoon();
        this._syncMedia();
        this._relayout(true);
    }

    get monitorIndex() {
        return Main.layoutManager.primaryIndex;
    }

    get isOpen() {
        return this._state === State.OPEN;
    }

    // Queues a peek; see PeekQueue.
    showPeek(peek) {
        this._peekQueue.show(peek);
    }

    endPeekShowing(view) {
        this._peekQueue.endIfShowing(view);
    }

    // The view of the peek showing, or null.
    get peekView() {
        return this._peekQueue.current?.view ?? null;
    }

    // Lays the notch out again after what it shows has changed.
    relayout() {
        this._relayout();
    }

    get _scale() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
    }

    get _zoom() {
        return this._zoomSource.layoutValue;
    }

    // The closed notch is as tall as the top bar, like boring.notch's
    // "match menu bar" height on Macs without a notch.
    get _notchHeight() {
        const height = Main.panel.height / this._scale;
        return height > 0 ? height : FALLBACK_PANEL_HEIGHT;
    }

    open(tab = this._tab) {
        if (tab === 'shelf' && !this._settings.get_boolean('show-shelf'))
            tab = 'home';
        const opening = this._state !== State.OPEN;
        if (!opening && tab === this._tab)
            return;
        this._tab = tab;
        this._openView.setTab(tab);
        this._clearTimeout('hover');

        if (opening) {
            this._state = State.OPEN;
            this._clearPeeks();
            this._live.setOpen(true);
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

    // With the Shelf tab turned off, an open notch leaves it.
    _syncShelfTab() {
        if (this._state === State.OPEN && this._tab === 'shelf' && !this._settings.get_boolean('show-shelf'))
            this.open('home');
    }

    close() {
        if (this._state === State.CLOSED)
            return;
        this._state = State.CLOSED;
        this._clearTimeout('hover');
        this._clearTimeout('keyboard');
        if (!this._settings.get_boolean('remember-last-tab'))
            this._tab = 'home';

        this._showOpenView(false);
        this._openView.closeBatteryPanel();
        this._openView.resetToday();
        this._fade(this._closedLayer, true, FADE_MS);
        this._openView.stopTicking();
        this._live.setOpen(false);
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

    // For the toggle-notch shortcut.
    toggleFromKeyboard() {
        if (this._state === State.OPEN) {
            this.close();
            return;
        }
        this.open();
        this._setTimeout('keyboard', KEYBOARD_OPEN_MS, () => {
            if (!this.hover)
                this.close();
        });
    }

    // For the music-peek shortcut: show what is playing now.
    showMusicPeek() {
        const player = this._media.activePlayer;
        if (player)
            this._onTrackChanged(player, true);
    }

    /**
     * Shows a volume or brightness change in the notch. Returns false when
     * the notch cannot show it, so the caller can fall back to the GNOME
     * popup.
     */
    showHud(icon, label, level, maxLevel) {
        if (!this.visible)
            return false;
        if (this._state === State.OPEN) {
            return this._settings.get_boolean('hud-in-open-notch') &&
                this._openView.showHud(icon, level, maxLevel);
        }
        // The row style grows the notch a row under the clock instead of
        // sharing the top-bar row with the clock.
        const hud = this._settings.get_string('hud-style') === 'row'
            ? this._hudRow : this._hud;
        this.showPeek({
            view: hud,
            apply: () => hud.update(icon, label, level, maxLevel),
            timeout: HUD_TIMEOUT_MS,
            priority: Priority.HUD,
            key: 'hud',
        });
        return true;
    }

    /**
     * Shows a new notification as a peek. Returns false when the notch
     * cannot show it, so the caller can fall back to a GNOME banner.
     */
    showNotification(notification) {
        if (this._state === State.OPEN || !this.visible)
            return false;
        return this._systemPeeks.showNotification(notification);
    }

    _onTrackChanged(player, force = false) {
        if (this._state === State.OPEN || !this.visible)
            return;
        if (!force && !this._settings.get_boolean('music-peek'))
            return;
        this.showPeek({
            view: this._musicPeek,
            apply: () => this._musicPeek.update(player, this._artUri),
            timeout: MUSIC_PEEK_TIMEOUT_MS,
            action: () => this.open('home'),
            priority: Priority.MUSIC,
            key: 'music',
        });
    }

    _onPrivacyChanged(state) {
        this._privacyState = state;
        this._syncPrivacyDots();
    }

    // One dot per kind of use, beside the clock. Hidden kinds add no width,
    // so the notch only changes shape when they appear.
    _syncPrivacyDots() {
        const show = this._settings.get_boolean('show-privacy-indicators');
        const {mic, camera, sharing} = this._privacyState;
        this._privacyDots.mic.visible = show && mic.length > 0;
        this._privacyDots.camera.visible = show && camera;
        this._privacyDots.sharing.visible = show && sharing;
        this._relayout();
    }

    // The moon beside the clock while Do Not Disturb is on.
    _syncMoon() {
        this._dndMoon.visible = this._settings.get_boolean('show-dnd') &&
            !this._dndSettings.get_boolean('show-banners');
        this._relayout();
    }

    _clearPeeks() {
        this._peekQueue.clear();
        this._syncMusicPeekScroll();
        this._live.syncTimer();
    }

    // Long titles slide in the music peek, which only shows while the
    // notch is closed.
    _syncMusicPeekScroll() {
        this._musicPeek.setScrolling(
            this._settings.get_boolean('scroll-titles') &&
            this.peekView === this._musicPeek && this._state === State.CLOSED);
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
            this._setTimeout('linger', this._settings.get_int('media-linger-seconds') * 1000, () => {
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
        // The colour belongs to the old track from here on: it is dropped
        // and the decode in flight is stopped.
        this._artColorRgb = null;
        this._artColorTrack = null;
        this._artColor?.cancel();
        this._applyArtColor();
        this._artCache.resolve(url, uri => {
            // Ignore answers for a track that is no longer playing. The
            // player itself can be gone by now: a cover from a browser
            // that closed after a track change has no one to update.
            if (this._artUrl !== url || !this._artCache)
                return;
            this._artUri = uri;
            this._liveMedia.update(uri);
            const player = this._media.activePlayer;
            if (this.peekView === this._musicPeek)
                this._musicPeek.update(player, uri);
            this._openView.update(player, uri);
            this._loadArtColor(url, uri);
        });
    }

    _loadArtColor(track, uri) {
        if (!uri || !this._artColor || !this._settings.get_boolean('art-colors'))
            return;
        this._artColorTrack = track;
        this._artColor.averageColor(uri).then(rgb => {
            // Ignore an answer for a track that is no longer playing, as
            // _syncArt does for its uri.
            if (this._artColorTrack !== track || !this._artColor)
                return;
            this._artColorRgb = rgb;
            this._applyArtColor();
        }).catch(() => {});
    }

    // Turning the setting off and on takes the current colour away and
    // decodes it again.
    _syncArtColors() {
        this._artColorRgb = null;
        this._artColorTrack = null;
        this._artColor?.cancel();
        this._applyArtColor();
        if (this._settings.get_boolean('art-colors'))
            this._loadArtColor(this._artUrl, this._artUri);
    }

    // Hand the cover's colour to the bars and the open player.
    _applyArtColor() {
        this._liveMedia.setColor(this._artColorRgb);
        this._openView.setColor(this._artColorRgb);
    }

    // Peeks first, then live activities in order of how much they matter
    // right now.
    _currentClosedView() {
        if (this.peekView)
            return this.peekView;
        const live = this._live.current();
        if (live)
            return live;
        if (this._showMedia)
            return this._liveMedia;
        return null;
    }

    _onHoverChanged() {
        this._clearTimeout('hover');
        // After a press on a peek's button, hover waits for the pointer to
        // leave before it can open the notch again.
        this._hoverHeld = this.hover && this._hoverHeld;
        if (this.hover)
            this._clearTimeout('keyboard');

        if (this.hover && !this._hoverHeld && this._state === State.CLOSED) {
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
            height = notchHeight + (view?.extraHeight() ?? 0);
            radii = RADII.closed;
            if (this.hover && !view) {
                width += HOVER_GROWTH.width * zoom;
                height += HOVER_GROWTH.height * zoom;
            }
            this._showClosedView(view);
            this._showClock(showClock);

            // Only the current view takes the new size; one fading out
            // keeps the width it had.
            if (view && this.get_stage())
                this._place(view, width * scale, height * scale);
            // Sizing needs the notch on the stage, which it only is once it
            // has been added to the top chrome.
            if (this.get_stage())
                this._place(this._clockSlot, width * scale, notchHeight * scale);
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
        for (const child of this._closedLayer.get_children()) {
            if (child._bnHalf !== undefined)
                child.translation_x = half - child._bnHalf;
        }
        this._openView.translation_x = half - this._openHalf;
    }

    // Sizes a closed-layer child, centred on whole device pixels.
    _place(actor, width, height) {
        const half = this._snap(width / 2);
        actor._bnHalf = half;
        actor.set_size(2 * half, height);
        actor.translation_x = this._snap(this.width / 2) - half;
    }

    _buildMenu(openPreferences) {
        const menu = new PopupMenu.PopupMenu(this, 0.5, St.Side.TOP);
        menu.addAction('Today', () => this.open('today'));
        menu.addAction('Timer', () => this.open('timer'));
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addAction('Settings', () => openPreferences());
        Main.uiGroup.add_child(menu.actor);
        menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this);
        this._menuManager.addMenu(menu);
        return menu;
    }

    _onButtonPress(event) {
        const button = event.get_button();
        if (button === Clutter.BUTTON_SECONDARY) {
            this._menu.toggle();
            return Clutter.EVENT_STOP;
        }
        if (this._state !== State.CLOSED)
            return Clutter.EVENT_PROPAGATE;
        if (button === Clutter.BUTTON_MIDDLE) {
            this._media.activePlayer?.playPause();
            return Clutter.EVENT_STOP;
        }
        if (this.peekView === null && this._live.press(this._closedView))
            return Clutter.EVENT_STOP;
        // A press on a control inside a peek (the volume bar, a
        // notification's button) is the control's. It deals with the peek, so
        // hover must not open the notch afterwards until the pointer has left
        // and come back.
        if (this.peekView?.takesPress(event)) {
            this._hoverHeld = true;
            this._clearTimeout('hover');
            return Clutter.EVENT_PROPAGATE;
        }
        const action = this._peekQueue.current?.action;
        if (action) {
            this._peekQueue.end();
            action();
        } else {
            this.open();
        }
        return Clutter.EVENT_STOP;
    }

    /**
     * Mouse wheel on the closed notch changes the volume. On a touchpad,
     * swiping down opens the notch, swiping up closes it, and swiping
     * sideways changes track while music shows.
     */
    _onScroll(event) {
        if (!this._settings.get_boolean('gestures'))
            return Clutter.EVENT_PROPAGATE;

        const direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.DOWN) {
            if (this._state !== State.CLOSED || !this._settings.get_boolean('scroll-volume'))
                return Clutter.EVENT_PROPAGATE;
            this._changeVolume(direction === Clutter.ScrollDirection.UP ? 1 : -1);
            return Clutter.EVENT_STOP;
        }
        if (direction !== Clutter.ScrollDirection.SMOOTH)
            return Clutter.EVENT_PROPAGATE;

        let [dx, dy] = event.get_scroll_delta();
        if (event.get_scroll_source() !== Clutter.ScrollSource.FINGER) {
            // A smooth mouse wheel: whole notches of it change the volume.
            if (this._state !== State.CLOSED || !this._settings.get_boolean('scroll-volume'))
                return Clutter.EVENT_PROPAGATE;
            this._gesture.dy += dy;
            const steps = Math.trunc(this._gesture.dy);
            if (steps !== 0) {
                this._gesture.dy -= steps;
                this._changeVolume(-steps);
            }
            return Clutter.EVENT_STOP;
        }

        // Natural scrolling flips the deltas; undo that so "fingers move
        // down" always means open.
        if (this._touchpadSettings.get_boolean('natural-scroll')) {
            dx = -dx;
            dy = -dy;
        }
        const g = this._gesture;
        const now = GLib.get_monotonic_time();
        if (now - g.time > GESTURE_GAP_US || event.get_scroll_finish_flags() !== Clutter.ScrollFinishFlags.NONE)
            Object.assign(g, {dx: 0, dy: 0, done: false});
        g.time = now;
        if (g.done)
            return Clutter.EVENT_STOP;
        g.dx += dx;
        g.dy += dy;

        if (this._state === State.CLOSED && g.dy > SWIPE_THRESHOLD) {
            g.done = true;
            this.open();
        } else if (this._state === State.OPEN && g.dy < -SWIPE_THRESHOLD) {
            g.done = true;
            this.close();
        } else if (this._state === State.CLOSED && Math.abs(g.dx) > SWIPE_THRESHOLD &&
                   [this._liveMedia, this._musicPeek].includes(this._closedView)) {
            g.done = true;
            if (g.dx < 0)
                this._media.activePlayer?.next();
            else
                this._media.activePlayer?.previous();
        }
        return Clutter.EVENT_STOP;
    }

    _changeVolume(steps) {
        const current = getVolume();
        if (current === null)
            return;
        const {level, maxLevel} = setVolume(current + steps * VOLUME_STEP, this._soundSettings);
        this.showHud(volumeIcon(level), null, level, maxLevel);
    }

    // Sets a level dragged from the HUD bar and tells the view what it came
    // to, or returns null where nothing here can set it.
    _adjustHud(kind, level, maxLevel) {
        if (kind === 'volume')
            return setVolume(level, this._soundSettings)?.level ?? null;
        if (kind === 'brightness')
            return setBrightness(level, maxLevel);
        return null;
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
                if (isFinished && !visible) {
                    actor.hide();
                    actor.onHidden?.();
                }
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
        this._menu.destroy();
        this._peekQueue.destroy();
        this._systemPeeks.destroy();
        this._live.destroy();
        this._timeouts.forEach(id => GLib.source_remove(id));
        this._timeouts.clear();
        this._animator.destroy();
        this._springs = null;
        this._indicator?.disconnectObject(this);
        this._wallClock = null;
        this._artCache = null;
        this._artColor?.cancel();
        this._artColor = null;
    }
});
