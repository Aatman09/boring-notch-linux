import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import {BatterySneakView, IconTextView, NotificationPeekView, ScreenshotPeekView} from './closedViews.js';
import {Priority} from './peekQueue.js';

const BATTERY_TIMEOUT_MS = 2500;
const BATTERY_LEVEL_TIMEOUT_MS = 4000;
// gnome-settings-daemon posts its own battery notification when a warning
// level is reached; one is not worth two for this long after ours.
const BATTERY_NOTICE_WINDOW_MS = 2000;
const BLUETOOTH_TIMEOUT_MS = 2500;
const NOTIFICATION_TIMEOUT_MS = 4000;
const DOWNLOAD_TIMEOUT_MS = 4000;
const PRIVACY_TIMEOUT_MS = 3000;
const SCREENSHOT_TIMEOUT_MS = 4000;
const DND_TIMEOUT_MS = 2500;
const KEYBOARD_TIMEOUT_MS = 1200;
const AUDIO_ROUTE_TIMEOUT_MS = 2500;

/**
 * Turns what happens on the system into peeks: notifications and
 * screenshots, the charger and battery levels, power saver, an app starting
 * to use the microphone or camera, Bluetooth devices, Do Not Disturb, Caps
 * Lock and the keyboard layout, the sound output and finished downloads.
 *
 * Each kind checks its own setting and stays quiet while the notch is open.
 * The views are made here; the island puts `views` into the closed notch
 * and shows the peeks through `host.showPeek()`.
 */
export class SystemPeeks {
    constructor({settings, sources, dndSettings, host}) {
        this._settings = settings;
        this._host = host;
        this._battery = sources.battery;
        this._connected = [sources.battery, sources.privacy, sources.bluetooth,
            sources.keyboard, sources.audioRoute, sources.downloads, dndSettings];
        this._downloads = sources.downloads;
        this._dndSettings = dndSettings;
        this._dnd = !dndSettings.get_boolean('show-banners');
        // gnome-settings-daemon's battery notice is dropped until then,
        // after one of our battery-level peeks; zero means never drop.
        this._batteryNoticeUntil = 0;

        this.batteryView = new BatterySneakView();
        this.messageView = new NotificationPeekView();
        this._privacyView = new IconTextView('bn-privacy-peek', 145, {peek: true});
        this._screenshotView = new ScreenshotPeekView();
        this._bluetoothView = new IconTextView('bn-bluetooth-peek', 130, {peek: true});
        this._dndView = new IconTextView('bn-dnd-peek', 110, {peek: true});
        this._keyboardView = new IconTextView('bn-keyboard-peek', 105, {peek: true});
        this._audioRouteView = new IconTextView('bn-audio-route', 110, {peek: true, centred: true});
        this.views = [this.batteryView, this.messageView, this._privacyView,
            this._screenshotView, this._bluetoothView, this._dndView,
            this._keyboardView, this._audioRouteView];

        sources.battery.connectObject(
            'plugged', () => this._onPlugged(),
            'warning', (_m, level) => this._showBatteryLevel(level >= 4 ? 'critical' : 'low'),
            'full', () => this._showBatteryLevel('full'),
            'power-saver', () => this._onPowerSaver(),
            this);
        sources.privacy.connectObject('started',
            (_p, kind, appName) => this._onPrivacyStarted(kind, appName), this);
        sources.bluetooth.connectObject(
            'connected', (_b, device) => this._onBluetooth(device, true),
            'disconnected', (_b, device) => this._onBluetooth(device, false),
            this);
        sources.keyboard.connectObject(
            'caps-lock', (_k, on) => this._showKeyboard(on ? 'Caps Lock on' : 'Caps Lock off'),
            'layout', (_k, source) => this._showKeyboard(source.shortName, source.displayName),
            this);
        sources.audioRoute.connectObject('changed',
            (_r, route) => this._onAudioRouteChanged(route), this);
        sources.downloads.connectObject('finished',
            (_d, file) => this._onDownloadFinished(file), this);
        dndSettings.connectObject('changed::show-banners',
            () => this._onBannersChanged(), this);
    }

    // Whether a peek for this setting may show now.
    _allowed(key) {
        return this._settings.get_boolean(key) && !this._host.isOpen;
    }

    /**
     * Shows a new notification as a peek; clicking it opens the
     * notification. Returns false when the notch cannot show it, so the
     * caller can fall back to a GNOME banner.
     */
    showNotification(notification) {
        // A gicon named after the battery is gnome-settings-daemon's own
        // battery notice; drop it while our battery-level peek is on or has
        // just ended, so low and full battery do not pop twice.
        if (notification.gicon instanceof Gio.ThemedIcon &&
            notification.gicon.names.some(name => name.startsWith('battery')) &&
            GLib.get_monotonic_time() < this._batteryNoticeUntil)
            return true;

        // GNOME posts one notification per screenshot and puts the image in
        // gicon itself; recordings come with an ordinary icon. Match on the
        // icon's type, never on the translated text.
        if (this._settings.get_boolean('screenshot-peek') &&
            notification.gicon instanceof St.ImageContent) {
            this._host.showPeek({
                view: this._screenshotView,
                apply: () => this._screenshotView.update(notification.gicon),
                timeout: SCREENSHOT_TIMEOUT_MS,
                action: () => notification.activate(),
                priority: Priority.NOTIFICATION,
                key: 'screenshot',
            });
            return true;
        }

        const buttons = this._settings.get_boolean('notification-buttons')
            ? notification.actions.slice(0, 2) : [];
        const content = {
            icon: notification.gicon ?? notification.source?.icon ?? null,
            iconName: 'preferences-system-notifications-symbolic',
            title: notification.title ?? '',
            body: (notification.body ?? '').replace(/\s+/g, ' '),
            // A button runs the notification's own action and ends the peek,
            // if that peek is still the one showing.
            actions: buttons.map(action => ({
                label: action.label,
                activate: () => {
                    action.activate();
                    this._host.endPeekShowing(this.messageView);
                },
            })),
        };
        this._host.showPeek({
            view: this.messageView,
            apply: () => this.messageView.update(content),
            timeout: NOTIFICATION_TIMEOUT_MS,
            action: () => notification.activate(),
            priority: Priority.NOTIFICATION,
        });
        return true;
    }

    _onPlugged() {
        if (!this._allowed('show-battery-activity'))
            return;
        this._host.showPeek({
            view: this.batteryView,
            apply: () => this.batteryView.update(this._battery),
            timeout: BATTERY_TIMEOUT_MS,
            key: 'battery',
        });
    }

    _onPowerSaver() {
        if (!this._allowed('power-saver-peek'))
            return;
        this._host.showPeek({
            view: this.batteryView,
            apply: () => this.batteryView.update(this._battery, 'saver'),
            timeout: BATTERY_TIMEOUT_MS,
            key: 'battery-saver',
        });
    }

    _showBatteryLevel(mark) {
        if (!this._allowed('show-battery-warnings'))
            return;
        this._batteryNoticeUntil = GLib.get_monotonic_time() +
            1000 * (BATTERY_LEVEL_TIMEOUT_MS + BATTERY_NOTICE_WINDOW_MS);
        this._host.showPeek({
            view: this.batteryView,
            apply: () => this.batteryView.update(this._battery, mark),
            timeout: BATTERY_LEVEL_TIMEOUT_MS,
            priority: mark === 'critical' ? Priority.NOTIFICATION : Priority.STATUS,
            key: 'battery-level',
        });
    }

    _onPrivacyStarted(kind, appName) {
        if (!this._allowed('show-privacy-indicators'))
            return;
        const device = kind === 'mic' ? 'microphone' : 'camera';
        this._host.showPeek({
            view: this._privacyView,
            apply: () => this._privacyView.update({
                iconName: kind === 'mic' ? 'audio-input-microphone-symbolic' : 'camera-web-symbolic',
                title: `${appName || 'An app'} is using the ${device}`,
            }),
            timeout: PRIVACY_TIMEOUT_MS,
            action: () => {
                try {
                    Gio.Subprocess.new(['gnome-control-center', 'privacy'],
                        Gio.SubprocessFlags.NONE);
                } catch (e) {
                    console.warn(`Boring Notch: cannot open the privacy panel: ${e.message}`);
                }
            },
            key: 'privacy',
        });
    }

    _onBluetooth(device, connected) {
        if (!this._allowed('show-bluetooth'))
            return;
        this._host.showPeek({
            view: this._bluetoothView,
            apply: () => this._bluetoothView.update({
                icon: device.icon,
                title: device.alias,
                // No matter how much charge a leaving device still had, the
                // level it had is not what matters about a disconnect.
                body: !connected ? 'Disconnected'
                    : device.battery !== null ? `${device.battery}%` : 'Connected',
            }),
            timeout: BLUETOOTH_TIMEOUT_MS,
            key: 'bluetooth',
        });
    }

    // Do Not Disturb is the show-banners key with banners stopped. The peek
    // only fires when the key really changes.
    _onBannersChanged() {
        const dnd = !this._dndSettings.get_boolean('show-banners');
        if (dnd === this._dnd)
            return;
        this._dnd = dnd;
        if (!this._allowed('show-dnd'))
            return;
        this._host.showPeek({
            view: this._dndView,
            apply: () => this._dndView.update({
                iconName: 'weather-clear-night-symbolic',
                title: dnd ? 'Do Not Disturb on' : 'Do Not Disturb off',
            }),
            timeout: DND_TIMEOUT_MS,
            key: 'dnd',
        });
    }

    // Caps Lock and layout changes share one peek, so pressing both in
    // short order updates it instead of queueing two.
    _showKeyboard(title, body = '') {
        if (!this._allowed('show-keyboard'))
            return;
        this._host.showPeek({
            view: this._keyboardView,
            apply: () => this._keyboardView.update({
                iconName: 'input-keyboard-symbolic',
                title, body,
            }),
            timeout: KEYBOARD_TIMEOUT_MS,
            key: 'keyboard',
        });
    }

    _onAudioRouteChanged({name, iconName}) {
        if (!this._allowed('show-audio-route'))
            return;
        this._host.showPeek({
            view: this._audioRouteView,
            apply: () => this._audioRouteView.update({iconName, title: name}),
            timeout: AUDIO_ROUTE_TIMEOUT_MS,
            key: 'audio-route',
        });
    }

    _onDownloadFinished(file) {
        if (!this._allowed('show-downloads'))
            return;
        this._host.showPeek({
            view: this.messageView,
            apply: () => this.messageView.update({
                iconName: 'folder-download-symbolic',
                title: 'Downloaded',
                body: file.get_basename(),
            }),
            timeout: DOWNLOAD_TIMEOUT_MS,
            action: () => {
                const folder = this._downloads.folder?.get_uri();
                if (folder)
                    Gio.AppInfo.launch_default_for_uri(folder, global.create_app_launch_context(0, -1));
            },
        });
    }

    destroy() {
        this._connected.forEach(source => source.disconnectObject(this));
    }
}
