import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

Gio._promisify(Gio.DBusConnection.prototype, 'call');

const GSCONNECT = 'org.gnome.Shell.Extensions.GSConnect';
const GSCONNECT_DEVICES = '/org/gnome/Shell/Extensions/GSConnect/Device';
// How long GSConnect may take to answer before it counts as not there.
const GSCONNECT_TIMEOUT_MS = 1000;

// The first device GSConnect lists, or null. Device paths are the ids
// GSConnect exports under its Device object path. The call never starts
// GSConnect, and a GSConnect that does not answer in time counts as absent.
async function gsconnectDevice(cancellable) {
    try {
        const reply = await Gio.DBus.session.call(GSCONNECT, GSCONNECT_DEVICES,
            'org.freedesktop.DBus.Introspectable', 'Introspect', null,
            new GLib.VariantType('(s)'), Gio.DBusCallFlags.NO_AUTO_START,
            GSCONNECT_TIMEOUT_MS, cancellable);
        const [xml] = reply.deepUnpack();
        const match = /<node name="([^"]+)"/.exec(xml);
        return match ? `${GSCONNECT_DEVICES}/${match[1]}` : null;
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        return null;
    }
}

// Sends each file to the phone through GSConnect's shareFile action. The
// action's name and parameter are from GSConnect's documentation; GSConnect
// is not installed on the machine this was written on, so they are untested.
function sendToPhone(device, paths) {
    for (const path of paths) {
        Gio.DBus.session.call(GSCONNECT, device, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', ['shareFile', [new GLib.Variant('(sb)', [Gio.File.new_for_path(path).get_uri(), false])], {}]),
            null, Gio.DBusCallFlags.NO_AUTO_START, -1, null, null);
    }
}

function spawn(argv) {
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
}

/**
 * The ways to share a file that this computer has, each as {label, send}
 * where send(paths) hands the files over. refresh() looks again in the
 * background; `targets` holds what the last look found, and 'changed' is
 * emitted when it is done. Nothing here waits on another program while the
 * desktop waits.
 */
export class ShareTargets extends EventEmitter {
    constructor() {
        super();
        this._targets = [];
        this._cancellable = null;
    }

    get targets() {
        return this._targets;
    }

    async refresh() {
        this._cancellable?.cancel();
        const cancellable = new Gio.Cancellable();
        this._cancellable = cancellable;

        const targets = [];
        try {
            const device = await gsconnectDevice(cancellable);
            if (device)
                targets.push({label: 'Phone', send: paths => sendToPhone(device, paths)});
        } catch {
            return;
        }
        if (GLib.find_program_in_path('bluetooth-sendto'))
            targets.push({label: 'Bluetooth', send: paths => spawn(['bluetooth-sendto', ...paths])});
        const localsend = Shell.AppSystem.get_default().get_installed().find(app => /^localsend/.test(app.get_id()));
        if (localsend) {
            // Untested: LocalSend has no documented command line for sending files.
            targets.push({
                label: 'LocalSend',
                send: paths => localsend.launch(paths.map(p => Gio.File.new_for_path(p)), global.create_app_launch_context(0, -1)),
            });
        }
        if (GLib.find_program_in_path('xdg-email'))
            targets.push({label: 'Email', send: paths => spawn(['xdg-email', ...paths.flatMap(p => ['--attach', p])])});

        this._targets = targets;
        this.emit('changed');
    }

    // Stops a look in progress. The owner's connectObject handlers go with
    // the owner; disconnecting them here as well would throw.
    destroy() {
        this._cancellable?.cancel();
    }
}
