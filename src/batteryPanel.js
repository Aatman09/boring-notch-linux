import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

// "1 h 20 min", or "45 min" under an hour.
function formatDuration(seconds) {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
}

function openPowerSettings() {
    try {
        Gio.Subprocess.new(['gnome-control-center', 'power'], Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.warn(`Boring Notch: cannot open the power settings: ${e.message}`);
    }
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
        this._title = new St.Label({style_class: 'bn-battery-panel-title', x_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._title);

        this._rows = {};
        for (const key of ['status', 'time', 'health', 'rate', 'saver']) {
            const row = new St.BoxLayout({style_class: 'bn-battery-panel-row', x_align: Clutter.ActorAlign.CENTER});
            const name = new St.Label({style_class: 'bn-battery-panel-name'});
            const value = new St.Label({style_class: 'bn-battery-panel-value'});
            row.add_child(name);
            row.add_child(value);
            this.add_child(row);
            this._rows[key] = {row, name, value};
        }

        const settings = new St.Button({
            style_class: 'bn-chip bn-battery-panel-settings',
            label: 'Power settings…',
            can_focus: true,
            x_align: Clutter.ActorAlign.CENTER,
        });
        settings.connect('clicked', () => openPowerSettings());
        this.add_child(settings);

        // Only the open panel needs the numbers, so it listens while shown.
        battery.connectObject('changed', () => this._sync(), this);
        this.connect('destroy', () => battery.disconnectObject(this));
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
