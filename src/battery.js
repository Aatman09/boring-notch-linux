import Gio from 'gi://Gio';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// UPower's display device stands in for BatteryActivityManager.swift: it
// combines all batteries into one and tells us when charging starts or stops.

const DeviceIface = `
<node>
  <interface name="org.freedesktop.UPower.Device">
    <property name="IsPresent" type="b" access="read"/>
    <property name="Percentage" type="d" access="read"/>
    <property name="State" type="u" access="read"/>
    <property name="IconName" type="s" access="read"/>
  </interface>
</node>`;

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DeviceIface);

const State = {CHARGING: 1, FULLY_CHARGED: 4, PENDING_CHARGE: 5};
const PLUGGED_IN = [State.CHARGING, State.FULLY_CHARGED, State.PENDING_CHARGE];

/**
 * Emits 'changed' on any battery update, and 'plugged' (with true or false)
 * when a charger is connected or removed.
 */
export class BatteryMonitor extends EventEmitter {
    constructor() {
        super();
        this._cancellable = new Gio.Cancellable();
        this._init();
    }

    async _init() {
        try {
            this._proxy = await DeviceProxy.newAsync(
                Gio.DBus.system, 'org.freedesktop.UPower',
                '/org/freedesktop/UPower/devices/DisplayDevice',
                this._cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Boring Notch: no battery information: ${e.message}`);
            return;
        }

        this._pluggedIn = this.pluggedIn;
        this._proxy.connectObject('g-properties-changed', () => {
            const pluggedIn = this.pluggedIn;
            this.emit('changed');
            if (this.present && pluggedIn !== this._pluggedIn)
                this.emit('plugged', pluggedIn);
            this._pluggedIn = pluggedIn;
        }, this);
        this.emit('changed');
    }

    get present() {
        return !!this._proxy?.IsPresent;
    }

    get percentage() {
        return Math.round(this._proxy?.Percentage ?? 0);
    }

    get charging() {
        return this._proxy?.State === State.CHARGING;
    }

    get pluggedIn() {
        return PLUGGED_IN.includes(this._proxy?.State);
    }

    get iconName() {
        return this._proxy?.IconName || 'battery-missing-symbolic';
    }

    destroy() {
        this._cancellable.cancel();
        this._proxy?.disconnectObject(this);
        this._proxy = null;
        this.disconnectAll();
    }
}
