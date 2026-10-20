import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

const CLOCK_MODES = [
    ['notch', 'In the notch'],
    ['right', 'Right side of the top bar'],
    ['keep', 'Where GNOME puts it'],
];

function clockRow(settings) {
    const row = new Adw.ComboRow({
        title: 'Clock',
        subtitle: 'In the notch, clicking the time or pressing Super+V opens your notifications and calendar',
        model: Gtk.StringList.new(CLOCK_MODES.map(([, label]) => label)),
    });
    const sync = () => {
        row.selected = Math.max(0, CLOCK_MODES.findIndex(([id]) => id === settings.get_string('clock-mode')));
    };
    sync();
    settings.connect('changed::clock-mode', sync);
    row.connect('notify::selected', () => settings.set_string('clock-mode', CLOCK_MODES[row.selected][0]));
    return row;
}

function spinRow(settings, key, title, subtitle, [lower, upper, step], digits = 0) {
    const row = Adw.SpinRow.new_with_range(lower, upper, step);
    row.digits = digits;
    row.set({title, subtitle});
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

export default class BoringNotchPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

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
        notch.add(clockRow(settings));
        page.add(notch);

        const activities = new Adw.PreferencesGroup({title: 'Live activities'});
        activities.add(switchRow(settings, 'show-visualizer', 'Music visualizer',
            'Animate the bars beside the album art while music plays'));
        activities.add(switchRow(settings, 'replace-osd', 'Volume and brightness',
            'Show changes in the notch instead of the GNOME popup'));
        activities.add(switchRow(settings, 'notifications-in-notch', 'Notifications',
            'Show new notifications in the notch instead of as banners'));
        activities.add(switchRow(settings, 'show-downloads', 'Downloads',
            'Show browser downloads while they run and when they finish'));
        activities.add(switchRow(settings, 'show-battery-activity', 'Battery',
            'Peek out when a charger is plugged in or removed'));
        page.add(activities);
    }
}
