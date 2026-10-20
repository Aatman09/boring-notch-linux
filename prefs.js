import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const CLOCK_MODES = [
    ['notch', 'In the notch'],
    ['right', 'Right side of the top bar'],
    ['keep', 'Where GNOME puts it'],
];

const PLAYER_BUTTONS = [
    ['', 'None'],
    ['shuffle', 'Shuffle'],
    ['previous', 'Previous'],
    ['back-15', 'Back 15 seconds'],
    ['play-pause', 'Play / pause'],
    ['forward-15', 'Forward 15 seconds'],
    ['next', 'Next'],
    ['repeat', 'Repeat'],
];
const PLAYER_SLOTS = 5;

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, [lower, upper, step], digits = 0) {
    const row = Adw.SpinRow.new_with_range(lower, upper, step);
    row.digits = digits;
    row.set({title, subtitle});
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

// A dropdown for a string setting with a fixed set of values.
function choiceRow(title, subtitle, choices, get, set) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: Gtk.StringList.new(choices.map(([, label]) => label)),
    });
    const sync = () => {
        row.selected = Math.max(0, choices.findIndex(([id]) => id === get()));
    };
    sync();
    row.connect('notify::selected', () => set(choices[row.selected][0]));
    return [row, sync];
}

// A shortcut, typed as GTK writes it, for example <Super><Shift>n. Empty
// turns it off.
function shortcutRow(settings, key, title) {
    const row = new Adw.EntryRow({title, show_apply_button: true});
    row.text = settings.get_strv(key)[0] ?? '';
    row.connect('apply', () => {
        const text = row.text.trim();
        if (text === '') {
            settings.set_strv(key, []);
            row.remove_css_class('error');
            return;
        }
        const [ok, keyval] = Gtk.accelerator_parse(text);
        if (ok && keyval !== 0) {
            settings.set_strv(key, [text]);
            row.remove_css_class('error');
        } else {
            row.add_css_class('error');
        }
    });
    return row;
}

function generalPage(settings) {
    const page = new Adw.PreferencesPage({title: 'General', icon_name: 'preferences-system-symbolic'});

    const notch = new Adw.PreferencesGroup({title: 'Notch'});
    notch.add(switchRow(settings, 'open-on-hover', 'Open on hover',
        'Open the notch when the pointer rests on it. Clicking always opens it.'));
    const delay = spinRow(settings, 'hover-delay', 'Hover delay',
        'Milliseconds before the notch opens', [0, 2000, 50]);
    settings.bind('open-on-hover', delay, 'sensitive', Gio.SettingsBindFlags.GET);
    notch.add(delay);
    notch.add(spinRow(settings, 'closed-width', 'Closed width',
        'Width of the closed notch in pixels', [120, 400, 5]));
    notch.add(spinRow(settings, 'size', 'Size',
        'Scale the notch and everything in it', [0.75, 1.5, 0.05], 2));
    notch.add(spinRow(settings, 'text-size', 'Text size',
        'Scale only the writing, including the calendar and notifications', [0.8, 1.6, 0.05], 2));
    const [clock, syncClock] = choiceRow('Clock',
        'In the notch, clicking the time or pressing Super+V opens your notifications and calendar',
        CLOCK_MODES, () => settings.get_string('clock-mode'), v => settings.set_string('clock-mode', v));
    settings.connect('changed::clock-mode', syncClock);
    notch.add(clock);
    notch.add(switchRow(settings, 'remember-last-tab', 'Remember the last tab',
        'Open on the tab used last time instead of Home'));
    page.add(notch);

    const gestures = new Adw.PreferencesGroup({title: 'Gestures'});
    gestures.add(switchRow(settings, 'gestures', 'Touchpad and mouse gestures',
        'Swipe down on the notch to open it, up to close it, and sideways to change track. Middle-click plays or pauses.'));
    const wheel = switchRow(settings, 'scroll-volume', 'Mouse wheel changes the volume',
        'Scroll over the closed notch');
    settings.bind('gestures', wheel, 'sensitive', Gio.SettingsBindFlags.GET);
    gestures.add(wheel);
    page.add(gestures);

    const shortcuts = new Adw.PreferencesGroup({
        title: 'Shortcuts',
        description: 'Type a shortcut such as <Super><Shift>n and press Enter. Leave it empty to turn it off.',
    });
    shortcuts.add(shortcutRow(settings, 'toggle-notch', 'Open or close the notch'));
    shortcuts.add(shortcutRow(settings, 'show-music-peek', 'Show what is playing'));
    page.add(shortcuts);
    return page;
}

function musicPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Music', icon_name: 'audio-x-generic-symbolic'});

    const closed = new Adw.PreferencesGroup({title: 'Closed notch'});
    closed.add(switchRow(settings, 'music-peek', 'Peek when a track starts',
        'Show the title and artist for a moment when music starts or the track changes'));
    closed.add(switchRow(settings, 'show-visualizer', 'Music visualizer',
        'Animate the bars beside the album art while music plays'));
    const follow = switchRow(settings, 'visualizer-follows-audio', 'Follow the music',
        'Bars move with the bass, mids and treble of what is playing. Only the speaker output level is read, never the microphone, and nothing is recorded.');
    settings.bind('show-visualizer', follow, 'sensitive', Gio.SettingsBindFlags.GET);
    closed.add(follow);
    closed.add(spinRow(settings, 'media-linger-seconds', 'Keep showing after pause',
        'Seconds the music stays in the closed notch after pausing', [0, 10, 1]));
    page.add(closed);

    const player = new Adw.PreferencesGroup({title: 'Player buttons', description: 'From left to right'});
    const syncs = [];
    for (let slot = 0; slot < PLAYER_SLOTS; slot++) {
        const slots = () => {
            const ids = settings.get_strv('player-buttons');
            return [...ids, ...Array(PLAYER_SLOTS).fill('')].slice(0, PLAYER_SLOTS);
        };
        const [row, sync] = choiceRow(`Button ${slot + 1}`, null, PLAYER_BUTTONS,
            () => slots()[slot],
            id => {
                const ids = slots();
                if (ids[slot] === id)
                    return;
                ids[slot] = id;
                settings.set_strv('player-buttons', ids.filter(i => i !== ''));
            });
        syncs.push(sync);
        player.add(row);
    }
    settings.connect('changed::player-buttons', () => syncs.forEach(s => s()));
    page.add(player);
    return page;
}

function peeksPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Peeks', icon_name: 'preferences-system-notifications-symbolic'});

    const group = new Adw.PreferencesGroup({
        title: 'Show in the notch',
        description: 'When several arrive at once, they take turns: volume first, then notifications, then the rest.',
    });
    group.add(switchRow(settings, 'notifications-in-notch', 'Notifications',
        'Show new notifications in the notch instead of as banners'));
    group.add(switchRow(settings, 'replace-osd', 'Volume and brightness',
        'Show changes in the notch instead of the GNOME popup'));
    const open = switchRow(settings, 'hud-in-open-notch', 'Volume and brightness while open',
        'Show changes in the header of the open notch too');
    settings.bind('replace-osd', open, 'sensitive', Gio.SettingsBindFlags.GET);
    group.add(open);
    group.add(switchRow(settings, 'show-downloads', 'Downloads',
        'Show browser downloads while they run and when they finish'));
    group.add(switchRow(settings, 'show-battery-activity', 'Battery',
        'Peek out when a charger is plugged in or removed'));
    page.add(group);
    return page;
}

function aboutPage(metadata) {
    const page = new Adw.PreferencesPage({title: 'About', icon_name: 'help-about-symbolic'});
    const group = new Adw.PreferencesGroup({
        title: metadata.name,
        description: `Version ${metadata['version-name'] ?? metadata.version ?? ''}. A port of boring.notch for GNOME, under the GPL-3.0.`,
    });
    const link = new Adw.ActionRow({title: 'Source code and issues', subtitle: metadata.url, activatable: true});
    link.add_suffix(new Gtk.Image({icon_name: 'adw-external-link-symbolic'}));
    link.connect('activated', () => Gio.AppInfo.launch_default_for_uri(metadata.url, null));
    group.add(link);
    page.add(group);
    return page;
}

export default class BoringNotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.add(generalPage(settings));
        window.add(musicPage(settings));
        window.add(peeksPage(settings));
        window.add(aboutPage(this.metadata));
    }
}
