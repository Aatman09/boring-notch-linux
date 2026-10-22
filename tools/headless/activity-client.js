// A client for the live-activity D-Bus API and the LauncherEntry signal,
// for activities.sh. It stays on the bus while it holds: the extension drops
// a program's activities when its bus name goes, so a one-shot gdbus call
// cannot leave an activity on screen for the checks.
// Usage: gjs -m activity-client.js HOLD_SECONDS CALL...
//   CALL is Method:(arguments as GVariant text), for example
//     Start:('build', 'applications-development-symbolic', 'Build', '', 0.4)
//   Emit:(arguments) emits com.canonical.Unity.LauncherEntry.Update.
//   Sleep:SECONDS waits before the next call.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const DEST = 'org.gnome.Shell.Extensions.BoringNotch';
const PATH = '/org/gnome/Shell/Extensions/BoringNotch';
const [hold, ...calls] = ARGV;
const bus = Gio.bus_get_sync(Gio.BusType.SESSION, null);

for (const call of calls) {
    const colon = call.indexOf(':');
    const method = call.slice(0, colon);
    if (method === 'Sleep') {
        GLib.usleep(Number(call.slice(colon + 1)) * 1e6);
        continue;
    }
    const args = GLib.Variant.parse(null, call.slice(colon + 1), null, null);
    try {
        if (method === 'Emit') {
            bus.emit_signal(null, '/com/canonical/unity/launcherentry/1',
                'com.canonical.Unity.LauncherEntry', 'Update', args);
            print('Emit: sent');
        } else {
            bus.call_sync(DEST, PATH, DEST, method, args, null, Gio.DBusCallFlags.NONE, -1, null);
            print(`${method}: ok`);
        }
    } catch (e) {
        print(`${method}: ${e.message}`);
    }
}

const loop = GLib.MainLoop.new(null, false);
GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Number(hold), () => {
    loop.quit();
    return GLib.SOURCE_REMOVE;
});
loop.run();
