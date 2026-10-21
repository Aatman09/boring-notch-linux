import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

const GSCONNECT = 'org.gnome.Shell.Extensions.GSConnect';
const GSCONNECT_DEVICES = '/org/gnome/Shell/Extensions/GSConnect/Device';

// The first device GSConnect lists, or null. Device paths are the ids
// GSConnect exports under its Device object path.
function gsconnectDevice() {
    try {
        const [xml] = Gio.DBus.session.call_sync(GSCONNECT, GSCONNECT_DEVICES,
            'org.freedesktop.DBus.Introspectable', 'Introspect', null,
            new GLib.VariantType('(s)'), Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
        const match = /<node name="([^"]+)"/.exec(xml);
        return match ? `${GSCONNECT_DEVICES}/${match[1]}` : null;
    } catch (e) {
        return null;
    }
}

function gsconnectRunning() {
    try {
        const [owned] = Gio.DBus.session.call_sync('org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'NameHasOwner', new GLib.Variant('(s)', [GSCONNECT]),
            new GLib.VariantType('(b)'), Gio.DBusCallFlags.NONE, -1, null).deepUnpack();
        return owned;
    } catch (e) {
        return false;
    }
}

// Sends each file to the phone through GSConnect's shareFile action. The
// action's name and parameter are from GSConnect's documentation; GSConnect
// is not installed on the machine this was written on, so they are untested.
function sendToPhone(paths) {
    const device = gsconnectDevice();
    if (!device)
        throw new Error('no GSConnect device');
    for (const path of paths) {
        Gio.DBus.session.call(GSCONNECT, device, 'org.gtk.Actions', 'Activate',
            new GLib.Variant('(sava{sv})', ['shareFile', [new GLib.Variant('(sb)', [Gio.File.new_for_path(path).get_uri(), false])], {}]),
            null, Gio.DBusCallFlags.NONE, -1, null, null);
    }
}

function spawn(argv) {
    Gio.Subprocess.new(argv, Gio.SubprocessFlags.NONE);
}

/**
 * The ways to share a file that this computer has, each as {label, send}
 * where send(paths) hands the files over. Checked when called: nothing that
 * is not installed or running is listed.
 */
export function shareTargets() {
    const targets = [];
    if (gsconnectRunning() && gsconnectDevice())
        targets.push({label: 'Phone', send: sendToPhone});
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
    return targets;
}
