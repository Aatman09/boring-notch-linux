import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// Other programs' live activities and peeks, sent over the session bus:
//
//   gdbus call --session --dest org.gnome.Shell.Extensions.BoringNotch \
//     --object-path /org/gnome/Shell/Extensions/BoringNotch \
//     --method org.gnome.Shell.Extensions.BoringNotch.Start \
//     build 'applications-development-symbolic' 'Build' 'step 3 of 7' 0.4
const BUS_NAME = 'org.gnome.Shell.Extensions.BoringNotch';
const OBJECT_PATH = '/org/gnome/Shell/Extensions/BoringNotch';
const INTERFACE_XML = `
<node>
  <interface name="${BUS_NAME}">
    <method name="Start">
      <arg type="s" name="id" direction="in"/>
      <arg type="s" name="icon" direction="in"/>
      <arg type="s" name="title" direction="in"/>
      <arg type="s" name="detail" direction="in"/>
      <arg type="d" name="progress" direction="in"/>
    </method>
    <method name="Update">
      <arg type="s" name="id" direction="in"/>
      <arg type="s" name="icon" direction="in"/>
      <arg type="s" name="title" direction="in"/>
      <arg type="s" name="detail" direction="in"/>
      <arg type="d" name="progress" direction="in"/>
    </method>
    <method name="End">
      <arg type="s" name="id" direction="in"/>
    </method>
    <method name="Peek">
      <arg type="s" name="icon" direction="in"/>
      <arg type="s" name="title" direction="in"/>
      <arg type="s" name="body" direction="in"/>
      <arg type="u" name="timeoutMs" direction="in"/>
    </method>
  </interface>
</node>`;

const MAX_ACTIVITIES = 10;
const MAX_CALLS_PER_SECOND = 10;
const ID_MAX = 64;
const ICON_MAX = 64;
const TITLE_MAX = 80;
const DETAIL_MAX = 120;
const PEEK_TIMEOUT_MIN_MS = 1000;
const PEEK_TIMEOUT_MAX_MS = 10000;

const ICON_NAME = /^[a-z0-9-]+$/;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

const refusal = reason => `${BUS_NAME}.Error.${reason}`;

// Text from another program: a string of at most `max` characters with no
// control characters in it.
const isText = (value, max) =>
    typeof value === 'string' && value.length <= max && !CONTROL_CHARACTERS.test(value);

const isIconName = value => typeof value === 'string' && ICON_NAME.test(value) && value.length <= ICON_MAX;

// Progress from 0 to 1, or -1 when there is none. Out-of-range numbers are
// clamped; anything that is not a number counts as none.
const clampProgress = progress => {
    if (!Number.isFinite(progress) || progress < 0)
        return -1;
    return Math.min(progress, 1);
};

/**
 * Lets other programs show live activities in the closed notch, and peeks.
 * Owns the session-bus name only while the "allow-external-activities"
 * setting is on, and emits 'changed' when the activities change and 'peek'
 * with {icon, title, body, timeout} for each Peek call.
 *
 * Each activity is {key, icon, title, detail, progress, updated}; `icon` is
 * a Gio.Icon. Its key is the caller's bus name and the id it chose, so two
 * programs cannot end each other's activities. A program's activities go
 * when its bus name does.
 */
export class ActivityApi extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._activities = new Map();
        this._calls = new Map();
        this._nameId = 0;

        this._exported = Gio.DBusExportedObject.wrapJSObject(INTERFACE_XML, this);
        this._exported.export(Gio.DBus.session, OBJECT_PATH);
        this._vanishedId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null,
            Gio.DBusSignalFlags.NONE,
            (_c, _s, _p, _i, _signal, params) => {
                const [name, , newOwner] = params.deep_unpack();
                if (newOwner === '')
                    this._dropSender(name);
            });
        settings.connectObject('changed::allow-external-activities', () => this._sync(), this);
        this._sync();
    }

    get list() {
        return [...this._activities.values()];
    }

    // Owns the bus name while the setting is on; releases it, and drops
    // what it had shown, while it is off.
    _sync() {
        if (this._settings.get_boolean('allow-external-activities')) {
            this._nameId ||= Gio.bus_own_name_on_connection(
                Gio.DBus.session, BUS_NAME, Gio.BusNameOwnerFlags.NONE, null, null);
            return;
        }
        if (this._nameId) {
            Gio.bus_unown_name(this._nameId);
            this._nameId = 0;
        }
        this._activities.clear();
        this._calls.clear();
        this.emit('changed');
    }

    // Whether a call may go ahead. The object stays exported on the shell's
    // own connection, where a program could still reach it through the
    // shell's unique bus name, so the setting is checked on every call; and
    // at most MAX_CALLS_PER_SECOND calls from one sender in any second are
    // let through. A refused call is answered here.
    _admit(invocation) {
        if (!this._settings.get_boolean('allow-external-activities')) {
            invocation.return_dbus_error(refusal('Disabled'), 'Other programs\' activities are switched off');
            return false;
        }
        const sender = invocation.get_sender();
        const now = GLib.get_monotonic_time();
        const recent = (this._calls.get(sender) ?? []).filter(t => now - t < GLib.USEC_PER_SEC);
        if (recent.length >= MAX_CALLS_PER_SECOND) {
            this._calls.set(sender, recent);
            invocation.return_dbus_error(refusal('TooManyCalls'), 'Too many calls in one second');
            return false;
        }
        recent.push(now);
        this._calls.set(sender, recent);
        return true;
    }

    _dropSender(sender) {
        this._calls.delete(sender);
        let removed = false;
        for (const key of this._activities.keys()) {
            if (key.startsWith(`${sender} `)) {
                this._activities.delete(key);
                removed = true;
            }
        }
        if (removed)
            this.emit('changed');
    }

    // Start and Update do the same: they show the activity, or change it
    // when the id is already shown.
    // GJS calls a method named ...Async with its arguments as one array and
    // the invocation, which says who called. The plain names get no
    // invocation, so they cannot tell the callers apart.
    StartAsync(params, invocation) {
        this._upsert(params, invocation);
    }

    UpdateAsync(params, invocation) {
        this._upsert(params, invocation);
    }

    _upsert([id, icon, title, detail, progress], invocation) {
        if (!this._admit(invocation))
            return;
        const sender = invocation.get_sender();
        if (!isText(id, ID_MAX) || id === '' || !isIconName(icon) ||
            !isText(title, TITLE_MAX) || !isText(detail, DETAIL_MAX)) {
            invocation.return_dbus_error(refusal('InvalidArgs'), 'Id, icon, title or detail is not valid');
            return;
        }
        const key = `${sender} ${id}`;
        if (!this._activities.has(key) && this._activities.size >= MAX_ACTIVITIES) {
            invocation.return_dbus_error(refusal('TooManyActivities'), `At most ${MAX_ACTIVITIES} activities`);
            return;
        }
        this._activities.set(key, {
            key,
            icon: Gio.ThemedIcon.new(icon),
            title,
            detail,
            progress: clampProgress(progress),
            updated: GLib.get_monotonic_time(),
        });
        invocation.return_value(null);
        this.emit('changed');
    }

    EndAsync([id], invocation) {
        if (!this._admit(invocation))
            return;
        const sender = invocation.get_sender();
        if (this._activities.delete(`${sender} ${id}`))
            this.emit('changed');
        invocation.return_value(null);
    }

    PeekAsync([icon, title, body, timeoutMs], invocation) {
        if (!this._admit(invocation))
            return;
        if (!isIconName(icon) || !isText(title, TITLE_MAX) || !isText(body, DETAIL_MAX)) {
            invocation.return_dbus_error(refusal('InvalidArgs'), 'Icon, title or body is not valid');
            return;
        }
        const timeout = Math.min(Math.max(timeoutMs, PEEK_TIMEOUT_MIN_MS), PEEK_TIMEOUT_MAX_MS);
        this.emit('peek', {icon: Gio.ThemedIcon.new(icon), title, body, timeout});
        invocation.return_value(null);
    }

    destroy() {
        this._settings.disconnectObject(this);
        Gio.DBus.session.signal_unsubscribe(this._vanishedId);
        if (this._nameId)
            Gio.bus_unown_name(this._nameId);
        this._nameId = 0;
        this._exported.unexport();
        this._exported = null;
        this._activities.clear();
        this.disconnectAll();
    }
}
