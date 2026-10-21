import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const ACCENT_MODES = [
    ['off', 'Default colours'],
    ['system', 'System accent'],
    ['custom', 'Custom'],
];

const CLOCK_MODES = [
    ['notch', 'In the notch'],
    ['right', 'Right side of the top bar'],
    ['keep', 'Where GNOME puts it'],
];

const HUD_STYLES = [
    ['inline', 'Bar beside the icon'],
    ['row', 'A row under the clock'],
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

    const colour = new Adw.PreferencesGroup({title: 'Colour'});
    const [accent, syncAccent] = choiceRow('Accent',
        'Tints the tab chips, the switches and the bars in the notch',
        ACCENT_MODES, () => settings.get_string('accent-mode'),
        v => settings.set_string('accent-mode', v));
    colour.add(accent);
    // The custom colour is picked with GTK's colour dialog and stored as
    // #rrggbb, the form the stylesheet reads.
    const custom = new Gtk.ColorDialogButton({dialog: new Gtk.ColorDialog()});
    custom.valign = Gtk.Align.CENTER;
    const syncCustom = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string('custom-accent')))
            custom.rgba = rgba;
        custom.visible = settings.get_string('accent-mode') === 'custom';
    };
    custom.connect('notify::rgba', () => {
        settings.set_string('custom-accent', `#${['red', 'green', 'blue']
            .map(bh => Math.round(custom.rgba[bh] * 255).toString(16).padStart(2, '0'))
            .join('')}`);
    });
    settings.connect('changed::accent-mode', () => {
        syncAccent();
        syncCustom();
    });
    settings.connect('changed::custom-accent', syncCustom);
    syncCustom();
    colour.add(custom);
    page.add(colour);

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
    closed.add(switchRow(settings, 'art-colors', 'Colours from the album art',
        'Tint the bars and, in the notch, the artist text and the seek bar with the cover\'s average colour'));
    closed.add(switchRow(settings, 'art-glow', 'Glow behind the cover',
        'A blurred copy of the cover shines behind it while the track plays'));
    closed.add(switchRow(settings, 'scroll-titles', 'Scroll long titles',
        'Titles and artists wider than their space slide through twice, instead of showing an ellipsis'));
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
    const [hudStyle, syncHudStyle] = choiceRow('Volume and brightness style',
        'In the closed notch', HUD_STYLES,
        () => settings.get_string('hud-style'),
        v => settings.set_string('hud-style', v));
    settings.bind('replace-osd', hudStyle, 'sensitive', Gio.SettingsBindFlags.GET);
    settings.connect('changed::hud-style', syncHudStyle);
    group.add(hudStyle);
    const percentage = switchRow(settings, 'hud-percentage', 'Percentage',
        'Show the number next to the bar, in both styles');
    settings.bind('replace-osd', percentage, 'sensitive', Gio.SettingsBindFlags.GET);
    group.add(percentage);
    group.add(switchRow(settings, 'show-downloads', 'Downloads',
        'Show browser downloads while they run and when they finish'));
    group.add(switchRow(settings, 'show-battery-activity', 'Battery',
        'Peek out when a charger is plugged in or removed'));

    const awareness = new Adw.PreferencesGroup({title: 'System awareness'});
    awareness.add(switchRow(settings, 'show-privacy-indicators',
        'Microphone, camera and screen sharing',
        'Dots beside the clock and a peek naming the app. It reads which apps use the microphone and camera but never records anything.'));
    awareness.add(switchRow(settings, 'screenshot-peek', 'Screenshots',
        'Show the screenshot instead of the notification text for a moment; click it to open the file'));
    awareness.add(switchRow(settings, 'show-bluetooth', 'Bluetooth devices',
        'Peek when a device connects or disconnects, with its battery level when known'));
    awareness.add(switchRow(settings, 'show-dnd', 'Do Not Disturb',
        'Show a moon beside the clock while Do Not Disturb is on, and a peek when it changes. The switch in the header of the open notch always works.'));
    awareness.add(switchRow(settings, 'show-battery-warnings', 'Low and full battery',
        'Warn when the battery runs low or critical, and when it finishes charging'));
    awareness.add(switchRow(settings, 'show-keyboard', 'Caps Lock and keyboard layout',
        'Peek when Caps Lock turns on or off, or when you switch to another keyboard layout'));
    awareness.add(switchRow(settings, 'show-recording', 'Screen recording',
        'Show a red dot and the elapsed time while GNOME screen records; a click on the notch stops the recording'));
    awareness.add(switchRow(settings, 'show-audio-route', 'Sound output',
        'Say Headphones or Speakers when the active sound output changes'));
    page.add(group);
    page.add(awareness);
    return page;
}

function informationPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Information', icon_name: 'dialog-information-symbolic'});

    const battery = new Adw.PreferencesGroup({title: 'Battery'});
    battery.add(switchRow(settings, 'battery-details', 'Battery details',
        'Click the battery in the header of the open notch to see its charge, time left, health and power saver state'));
    battery.add(switchRow(settings, 'power-saver-peek', 'Power saver peek',
        'Peek when the power profile changes to or from Power Saver'));
    page.add(battery);
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
        window.add(informationPage(settings));
        window.add(aboutPage(this.metadata));
    }
}
