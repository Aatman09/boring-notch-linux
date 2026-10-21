import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// The Unity launcher API that browsers, file managers and torrent clients
// use to show progress on their app icon. Ubuntu Dock listens to the same
// signal. Here it becomes a live activity with the app's icon and name.
const LAUNCHER_IFACE = 'com.canonical.Unity.LauncherEntry';
const APP_URI = /^application:\/\//;

/**
 * Keeps the apps that report progress through LauncherEntry, while their
 * progress is visible. Emits 'changed'. `list` holds the activities, each
 * {key, icon, title, detail, progress, updated} like ActivityApi's, with
 * the app's own icon and name.
 *
 * An app's entry goes when it hides its progress or its bus name goes.
 */
export class LauncherEntryWatcher extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._entries = new Map();

        this._updateId = Gio.DBus.session.signal_subscribe(
            null, LAUNCHER_IFACE, 'Update', null, null, Gio.DBusSignalFlags.NONE,
            (_c, sender, _p, _i, _signal, params) => this._onUpdate(sender, params));
        this._vanishedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _signal, params) => {
                const [name, , newOwner] = params.deep_unpack();
                if (newOwner === '')
                    this._dropSender(name);
            });
        settings.connectObject('changed::show-app-progress', () => {
            if (!settings.get_boolean('show-app-progress'))
                this._clear();
        }, this);
    }

    get list() {
        return [...this._entries.values()];
    }

    _onUpdate(sender, params) {
        if (!this._settings.get_boolean('show-app-progress'))
            return;
        const [appUri, properties] = params.deep_unpack();
        const appId = appUri.replace(APP_URI, '');
        if (!appId)
            return;
        const key = `${sender} ${appId}`;
        // Apps often send only what changed, so an update without
        // progress-visible keeps the entry as it was.
        const visible = properties['progress-visible']?.unpack() ?? this._entries.has(key);
        if (!visible) {
            if (this._entries.delete(key))
                this.emit('changed');
            return;
        }
        const previous = this._entries.get(key);
        const progress = properties.progress?.unpack() ?? previous?.progress ?? 0;
        const app = Shell.AppSystem.get_default().lookup_app(appId);
        this._entries.set(key, {
            key,
            icon: app?.get_icon() ?? Gio.ThemedIcon.new('application-x-executable-symbolic'),
            title: app?.get_name() ?? appId,
            detail: '',
            progress: Math.min(Math.max(progress, 0), 1),
            updated: GLib.get_monotonic_time(),
        });
        this.emit('changed');
    }

    _dropSender(sender) {
        let removed = false;
        for (const key of this._entries.keys()) {
            if (key.startsWith(`${sender} `)) {
                this._entries.delete(key);
                removed = true;
            }
        }
        if (removed)
            this.emit('changed');
    }

    _clear() {
        if (this._entries.size === 0)
            return;
        this._entries.clear();
        this.emit('changed');
    }

    destroy() {
        this._settings.disconnectObject(this);
        Gio.DBus.session.signal_unsubscribe(this._updateId);
        Gio.DBus.session.signal_unsubscribe(this._vanishedId);
        this._entries.clear();
        this.disconnectAll();
    }
}
