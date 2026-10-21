import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import {Extension, InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Urgency} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {ArtCache} from './src/art.js';
import {ArtColorLoader} from './src/artColor.js';
import {AudioLevels, IGNORED_RECORDING_APPS} from './src/audio.js';
import {AudioRouteMonitor} from './src/audioRoute.js';
import {BatteryMonitor} from './src/battery.js';
import {BluetoothMonitor} from './src/bluetooth.js';
import {ClipboardHistory} from './src/clipboard.js';
import {DownloadWatcher} from './src/downloads.js';
import {Island} from './src/island.js';
import {KeyboardMonitor} from './src/keyboard.js';
import {MediaManager} from './src/media.js';
import {PrivacyMonitor} from './src/privacy.js';
import {RecordingMonitor} from './src/recording.js';
import {Shelf} from './src/shelf.js';
import {ScaledStylesheet} from './src/style.js';
import {exclusive, Pomodoro, Stopwatch, Timer} from './src/timer.js';
import {Zoom} from './src/zoom.js';

/**
 * Puts the top bar clock where the clock-mode setting says: hidden (the
 * notch shows the time instead), moved to the right, or left alone.
 */
class ClockMover {
    constructor(settings) {
        this._settings = settings;
        this._settings.connectObject('changed::clock-mode', () => this._sync(), this);
        this._sync();
    }

    get _clock() {
        return Main.panel.statusArea.dateMenu?.container;
    }

    _sync() {
        const clock = this._clock;
        if (!clock)
            return;
        this._restore();

        const mode = this._settings.get_string('clock-mode');
        if (mode === 'notch') {
            clock.hide();
            this._hidden = true;
        } else if (mode === 'right') {
            const parent = clock.get_parent();
            this._home = {parent, index: parent.get_children().indexOf(clock)};
            parent.remove_child(clock);
            Main.panel._rightBox.insert_child_at_index(clock, 0);
        }
    }

    _restore() {
        const clock = this._clock;
        if (!clock)
            return;
        if (this._hidden) {
            clock.show();
            this._hidden = false;
        }
        if (this._home) {
            const {parent, index} = this._home;
            this._home = null;
            clock.get_parent()?.remove_child(clock);
            parent.insert_child_at_index(clock, index);
        }
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._restore();
    }
}

export default class BoringNotchExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._zoom = new Zoom(this._settings);
        this._stylesheet = new ScaledStylesheet(this.dir.resolve_relative_path('src/style.css'), this._zoom, this._settings);
        const timer = new Timer();
        const stopwatch = new Stopwatch();
        const pomodoro = new Pomodoro(this._settings);
        // The notch shows one timer figure: starting a mode resets the others.
        exclusive(timer, stopwatch, pomodoro);
        // Everything the notch watches or drives; each has destroy().
        const downloads = new DownloadWatcher();
        this._sources = {
            media: new MediaManager(this._settings),
            battery: new BatteryMonitor(),
            timer,
            stopwatch,
            pomodoro,
            downloads,
            shelf: new Shelf({settings: this._settings, downloads}),
            clipboard: new ClipboardHistory({settings: this._settings}),
            artCache: new ArtCache(),
            artColor: new ArtColorLoader(),
            audio: new AudioLevels(),
            privacy: new PrivacyMonitor(),
            bluetooth: new BluetoothMonitor(),
            keyboard: new KeyboardMonitor(),
            recording: new RecordingMonitor(),
            audioRoute: new AudioRouteMonitor(),
        };

        this._island = new Island({
            settings: this._settings,
            zoom: this._zoom,
            sources: this._sources,
            openPreferences: () => this.openPreferences(),
        });
        Main.layoutManager.addTopChrome(this._island, {trackFullscreen: true});

        this._clockMover = new ClockMover(this._settings);
        this._injectIntoShell();
        this._addKeybindings();
    }

    _addKeybindings() {
        const modes = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;
        const flags = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
        Main.wm.addKeybinding('toggle-notch', this._settings, flags, modes,
            () => this._island.toggleFromKeyboard());
        Main.wm.addKeybinding('show-music-peek', this._settings, flags, modes,
            () => this._island.showMusicPeek());
    }

    _injectIntoShell() {
        const island = this._island;
        const settings = this._settings;
        this._injections = new InjectionManager();

        // Every volume, brightness and keyboard OSD goes through
        // _showOsdWindow, one monitor at a time.
        this._injections.overrideMethod(Main.osdWindowManager, '_showOsdWindow', original =>
            function (monitorIndex, icon, label, level, maxLevel) {
                if (settings.get_boolean('replace-osd') &&
                    monitorIndex === island.monitorIndex &&
                    island.showHud(icon, label, level, maxLevel))
                    return;
                original.call(this, monitorIndex, icon, label, level, maxLevel);
            });

        // The tray calls _showNotification when the next banner is due, after
        // its own checks for Do Not Disturb, fullscreen and per-app banner
        // settings. Take that banner into the notch instead. Critical
        // notifications keep the GNOME banner, which can be expanded and
        // answered. Either way the notification stays in the list.
        this._injections.overrideMethod(Main.messageTray, '_showNotification', original =>
            function () {
                const notification = this._notificationQueue[0];
                if (notification &&
                    settings.get_boolean('notifications-in-notch') &&
                    notification.urgency !== Urgency.CRITICAL &&
                    island.showNotification(notification)) {
                    this._notificationQueue.shift();
                    this.emit('queue-changed');
                    return;
                }
                original.call(this);
            });

        // GNOME shows the microphone indicator while any app records audio,
        // and the visualizer's stream counts as recording even though it
        // only reads the speaker output. Leave just that stream out, the way
        // GNOME already leaves out the sound settings' level meters.
        const input = Main.panel.statusArea.quickSettings?._volumeInput?._input;
        if (input) {
            this._injections.overrideMethod(input, '_maybeShowInput', () =>
                function () {
                    this._showInput = !!this._stream &&
                        this._control.get_source_outputs().some(
                            output => !IGNORED_RECORDING_APPS.includes(output.get_application_id()));
                    this._sync();
                });
            input._maybeShowInput();
            this._micInput = input;
        }

        // Super+V, and clicking where the clock was, open the Today tab.
        this._injections.overrideMethod(Main.panel, 'toggleCalendar', original =>
            function () {
                if (settings.get_string('clock-mode') === 'notch')
                    island.toggle('today');
                else
                    original.call(this);
            });
    }

    disable() {
        Main.wm.removeKeybinding('toggle-notch');
        Main.wm.removeKeybinding('show-music-peek');
        this._injections.clear();
        this._injections = null;
        this._micInput?._maybeShowInput();
        this._micInput = null;

        this._clockMover.destroy();
        this._clockMover = null;

        Main.layoutManager.removeChrome(this._island);
        this._island.destroy();
        this._island = null;

        Object.values(this._sources).forEach(source => source.destroy());
        this._sources = null;
        this._stylesheet.destroy();
        this._stylesheet = null;
        this._zoom.destroy();
        this._zoom = null;
        this._settings = null;
    }
}
