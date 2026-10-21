import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {openSettingsPanel} from './widgets.js';

// "1 h 20 min", or "45 min" under an hour.
function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

/**
 * The battery details, drawn over the open notch's page when the battery in
 * the header is clicked. Rows that UPower has no value for are left out.
 */
export const BatteryPanel = GObject.registerClass(
class BatteryPanel extends St.BoxLayout {
    _init(battery) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-battery-panel',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._battery = battery;
        // The title and the way to GNOME's power settings share the top
        // line, and the rows sit in two columns: the panel has to fit the
        // open notch's shortest tabs.
        // Spacers above and below centre the content in the page.
        this.add_child(new St.Widget({y_expand: true}));
        const top = new St.BoxLayout({style_class: 'bn-battery-panel-top', x_align: Clutter.ActorAlign.CENTER});
        this._title = new St.Label({style_class: 'bn-battery-panel-title', y_align: Clutter.ActorAlign.CENTER});
        const settings = new St.Button({
            style_class: 'bn-chip',
            label: 'Power settings…',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        settings.connect('clicked', () => openSettingsPanel('power'));
        top.add_child(this._title);
        top.add_child(settings);
        this.add_child(top);

        const columns = new St.BoxLayout({style_class: 'bn-battery-panel-columns', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(columns);
        this._rows = {};
        for (const keys of [['status', 'time', 'health'], ['rate', 'saver']]) {
            const column = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'bn-battery-panel-column',
            });
            columns.add_child(column);
            for (const key of keys) {
                const row = new St.BoxLayout({style_class: 'bn-battery-panel-row'});
                const name = new St.Label({style_class: 'bn-battery-panel-name'});
                const value = new St.Label({style_class: 'bn-battery-panel-value'});
                row.add_child(name);
                row.add_child(value);
                column.add_child(row);
                this._rows[key] = {row, name, value};
            }
        }
        this.add_child(new St.Widget({y_expand: true}));

        // Updates only reach the labels while the panel is shown (_sync).
        battery.connectObject('changed', () => this._sync(), this);
    }

    open() {
        this.show();
        this._sync();
    }

    _setRow(key, name, value) {
        const {row, name: nameLabel, value: valueLabel} = this._rows[key];
        row.visible = value !== null;
        nameLabel.text = name;
        valueLabel.text = value ?? '';
    }

    _sync() {
        if (!this.visible)
            return;
        const battery = this._battery;
        this._title.text = `Battery ${battery.percentage}%`;
        this._setRow('status', 'Status', battery.statusText);

        const seconds = battery.charging ? battery.timeToFull : battery.timeToEmpty;
        this._setRow('time', battery.charging ? 'Time to full' : 'Time left',
            seconds > 0 ? formatDuration(seconds) : null);

        const health = battery.health;
        this._setRow('health', 'Health', health > 0 ? `${Math.round(health)}%` : null);

        const rate = battery.energyRate;
        this._setRow('rate', 'Energy rate', rate > 0 ? `${rate.toFixed(1)} W` : null);

        const saver = battery.powerSaver;
        this._setRow('saver', 'Power saver', saver === null ? null : saver ? 'On' : 'Off');
    }
});
