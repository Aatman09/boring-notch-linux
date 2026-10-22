# Reports progress through the Unity LauncherEntry API, the way Files or a
# browser does while copying or downloading. Usage: progress.py APP.desktop SECONDS
import sys
import time
from gi.repository import Gio, GLib

app, seconds = sys.argv[1], float(sys.argv[2])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
steps = 40
for i in range(steps + 1):
    visible = i < steps
    bus.emit_signal(None, '/com/canonical/unity/launcherentry/1', 'com.canonical.Unity.LauncherEntry', 'Update',
                    GLib.Variant('(sa{sv})', (f'application://{app}', {
                        'progress': GLib.Variant('d', i / steps),
                        'progress-visible': GLib.Variant('b', visible)})))
    bus.flush_sync(None)
    time.sleep(seconds / steps)
time.sleep(0.5)
