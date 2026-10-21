import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

import {iconButton} from './widgets.js';

const HEADER_HUD_MS = 1500;

// A tab with `setting` shows only while that setting is on.
const TABS = [
    {id: 'home', label: 'Home', icon: 'user-home-symbolic'},
    {id: 'today', label: 'Today', icon: 'x-office-calendar-symbolic'},
    {id: 'timer', label: 'Timer', icon: 'alarm-symbolic'},
    {id: 'system', label: 'System', icon: 'utilities-system-monitor-symbolic', setting: 'show-system-tab'},
];

/** BoringHeader: tabs on the left, settings and battery on the right. */
export const Header = GObject.registerClass({
    Signals: {
        'tab-selected': {param_types: [GObject.TYPE_STRING]},
        'battery-clicked': {},
    },
}, class Header extends St.BoxLayout {
    _init(battery, dndSettings, openPreferences, settings) {
        super._init({style_class: 'bn-header', x_expand: true});
        this._battery = battery;

        this._tabs = new Map();
        for (const {id, label, icon, setting} of TABS) {
            const box = new St.BoxLayout({style_class: 'bn-tab-content'});
            box.add_child(new St.Icon({icon_name: icon, style_class: 'bn-tab-icon'}));
            box.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            const tab = new St.Button({style_class: 'bn-tab', child: box, can_focus: true});
            if (setting)
                settings.bind(setting, tab, 'visible', Gio.SettingsBindFlags.GET);
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
        for (const [tabId, tab] of this._tabs)
            tab.checked = tabId === id;
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
