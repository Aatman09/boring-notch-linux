import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import GnomeBluetooth from 'gi://GnomeBluetooth?version=3.0';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// BlueZ flaps the connected flag for about a second during reconnections.
// A state change is only believed once the flag has been still this long.
const DEBOUNCE_MS = 1000;

/**
 * Watches Bluetooth devices the way the shell's own bluetooth.js client
 * does: the flags of the devices in the store count as the snapshot, and
 * only changes from there on are reported, so connecting while the
 * extension is starting produces no peek.
 *
 * Emits 'connected' and 'disconnected' with the device's alias, its icon
 * and its battery percentage, or null when the device reports none.
 */
export class BluetoothMonitor extends EventEmitter {
    constructor() {
        super();

        this._client = new GnomeBluetooth.Client();
        this._devices = new Map();

        const store = this._client.get_devices();
        for (let i = 0; i < store.get_n_items(); i++)
            this._watch(store.get_item(i));

        this._client.connectObject(
            'device-added', (_c, device) => this._watch(device),
            'device-removed', (_c, path) => this._unwatch(path),
            this);
    }

    // Watch one device from its state at this moment onwards.
    _watch(device) {
        const path = device.get_object_path();
        if (this._devices.has(path))
            return;
        this._devices.set(path, {
            device,
            debounceId: 0,
            connected: device.connected,
        });
        device.connectObject('notify::connected', () =>
            this._onChange(this._devices.get(path)), this);
    }

    _unwatch(path) {
        const entry = this._devices.get(path);
        if (!entry)
            return;
        entry.device.disconnectObject(this);
        if (entry.debounceId)
            GLib.source_remove(entry.debounceId);
        this._devices.delete(path);
    }

    _onChange(entry) {
        if (!entry)
            return;
        // Each flap restarts the wait; only the settled state is reported.
        if (entry.debounceId)
            GLib.source_remove(entry.debounceId);
        entry.debounceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, DEBOUNCE_MS, () => {
            entry.debounceId = 0;
            if (this._devices.get(entry.device.get_object_path()) !== entry) {
                this._forget(entry);
                return GLib.SOURCE_REMOVE;
            }
            const connected = entry.device.connected;
            if (connected === entry.connected)
                return GLib.SOURCE_REMOVE;
            entry.connected = connected;
            this.emit(connected ? 'connected' : 'disconnected',
                this._describe(entry.device));
            return GLib.SOURCE_REMOVE;
        });
    }

    _describe(device) {
        return {
            alias: device.alias,
            icon: new Gio.ThemedIcon({name: device.icon}),
            battery: this._batteryOf(device),
        };
    }

    // A percentage is only reported by devices that keep track of it; the
    // rest give a coarse level (low/full and the like), which is not worth
    // a number.
    _batteryOf(device) {
        if (device.battery_type !== GnomeBluetooth.BatteryType.PERCENTAGE)
            return null;
        return Math.round(device.battery_percentage);
    }

    destroy() {
        for (const path of [...this._devices.keys()])
            this._unwatch(path);
        this._client.disconnectObject(this);
        this.disconnectAll();
    }
}
