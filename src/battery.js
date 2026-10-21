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
    <property name="WarningLevel" type="u" access="read"/>
    <property name="IconName" type="s" access="read"/>
    <property name="TimeToEmpty" type="x" access="read"/>
    <property name="TimeToFull" type="x" access="read"/>
    <property name="EnergyRate" type="d" access="read"/>
    <property name="Capacity" type="d" access="read"/>
    <property name="Type" type="u" access="read"/>
  </interface>
</node>`;

const UPowerIface = `
<node>
  <interface name="org.freedesktop.UPower">
    <method name="EnumerateDevices">
      <arg name="devices" type="ao" direction="out"/>
    </method>
  </interface>
</node>`;

const PowerProfilesIface = `
<node>
  <interface name="org.freedesktop.UPower.PowerProfiles">
    <property name="ActiveProfile" type="s" access="read"/>
  </interface>
</node>`;

const DeviceProxy = Gio.DBusProxy.makeProxyWrapper(DeviceIface);
const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(UPowerIface);
const PowerProfilesProxy = Gio.DBusProxy.makeProxyWrapper(PowerProfilesIface);

const UPOWER_BUS = 'org.freedesktop.UPower';
const DISPLAY_DEVICE = '/org/freedesktop/UPower/devices/DisplayDevice';
const POWER_PROFILES_BUS = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_PATH = '/org/freedesktop/UPower/PowerProfiles';
const POWER_SAVER = 'power-saver';

const DEVICE_TYPE_BATTERY = 2;
const State = {CHARGING: 1, FULLY_CHARGED: 4, PENDING_CHARGE: 5};
const PLUGGED_IN = [State.CHARGING, State.FULLY_CHARGED, State.PENDING_CHARGE];
// UPower reports every level below "low" already at "discharging".
const WARNING_LOW = 3;

/**
 * Emits 'changed' on any battery update, 'plugged' (with true or false)
 * when a charger is connected or removed, 'warning' with the warning level
 * when it rises to "low" or beyond, 'full' when the display device
 * finishes charging while a charger is connected, and 'power-saver' (with
 * true or false) when the power profile moves to or from Power Saver.
 */
export class BatteryMonitor extends EventEmitter {
    constructor() {
        super();
        this._cancellable = new Gio.Cancellable();
        this._battery = null;
        this._profiles = null;
        this._powerSaver = null;
        this._init();
    }

    async _init() {
        try {
            this._proxy = await DeviceProxy.newAsync(
                Gio.DBus.system, UPOWER_BUS, DISPLAY_DEVICE,
                this._cancellable);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Boring Notch: no battery information: ${e.message}`);
            return;
        }

        this._pluggedIn = this.pluggedIn;
        this._lastState = this._proxy.State;
        this._warningLevel = this.warningLevel;
        this._proxy.connectObject('g-properties-changed', () => {
            const pluggedIn = this.pluggedIn;
            this.emit('changed');
            const level = this.warningLevel;
            if (level >= WARNING_LOW && level > this._warningLevel)
                this.emit('warning', level);
            this._warningLevel = level;
            const state = this._proxy.State;
            if (this.present && pluggedIn &&
                this._lastState === State.CHARGING && state === State.FULLY_CHARGED)
                this.emit('full');
            this._lastState = state;
            if (this.present && pluggedIn !== this._pluggedIn)
                this.emit('plugged', pluggedIn);
            this._pluggedIn = pluggedIn;
        }, this);
        this.emit('changed');
        this._initDetails();
    }

    // The battery's own health and the power profile are optional: without
    // them the panel leaves those rows out and there is no power-saver peek.
    async _initDetails() {
        try {
            const upower = await UPowerProxy.newAsync(
                Gio.DBus.system, UPOWER_BUS, '/org/freedesktop/UPower',
                this._cancellable);
            const [paths] = await upower.EnumerateDevicesAsync();
            for (const path of paths) {
                if (path === DISPLAY_DEVICE)
                    continue;
                const device = await DeviceProxy.newAsync(
                    Gio.DBus.system, UPOWER_BUS, path, this._cancellable);
                if (device.Type === DEVICE_TYPE_BATTERY && device.Capacity > 0) {
                    this._battery = device;
                    break;
                }
            }
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Boring Notch: no battery health: ${e.message}`);
        }

        try {
            this._profiles = await PowerProfilesProxy.newAsync(
                Gio.DBus.system, POWER_PROFILES_BUS, POWER_PROFILES_PATH,
                this._cancellable);
            this._powerSaver = this._profiles.ActiveProfile === POWER_SAVER;
            this._profiles.connectObject('g-properties-changed', () => {
                const saver = this._profiles.ActiveProfile === POWER_SAVER;
                if (saver === this._powerSaver)
                    return;
                this._powerSaver = saver;
                this.emit('changed');
                this.emit('power-saver', saver);
            }, this);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Boring Notch: no power profiles: ${e.message}`);
        }
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

    get warningLevel() {
        return this._proxy?.WarningLevel ?? 0;
    }

    get iconName() {
        return this._proxy?.IconName || 'battery-missing-symbolic';
    }

    // Seconds until full or empty; UPower reports 0 when it does not know.
    get timeToFull() {
        return Number(this._proxy?.TimeToFull ?? 0);
    }

    get timeToEmpty() {
        return Number(this._proxy?.TimeToEmpty ?? 0);
    }

    // Watts drawn or put in; 0 when UPower does not know.
    get energyRate() {
        return this._proxy?.EnergyRate ?? 0;
    }

    // Percent of the design capacity left, or 0 when UPower does not know.
    get health() {
        return this._battery?.Capacity ?? 0;
    }

    // Null when there is no power profile service to ask.
    get powerSaver() {
        return this._powerSaver;
    }

    get statusText() {
        if (this.charging)
            return 'Charging';
        if (this._proxy?.State === State.FULLY_CHARGED)
            return 'Fully charged';
        if (this._proxy?.State === State.PENDING_CHARGE)
            return 'Not charging';
        return this.pluggedIn ? 'Plugged in' : 'On battery';
    }

    destroy() {
        this._cancellable.cancel();
        this._proxy?.disconnectObject(this);
        this._proxy = null;
        this._profiles?.disconnectObject(this);
        this._profiles = null;
        this._battery = null;
        this.disconnectAll();
    }
}
