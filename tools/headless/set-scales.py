# Sets each headless monitor's scale, side by side, left to right.
# Usage: python3 -I set-scales.py 1.0 1.25   (one scale per monitor, in order)
import sys
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
call = lambda m, a, t: bus.call_sync('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
    'org.gnome.Mutter.DisplayConfig', m, a, t, Gio.DBusCallFlags.NONE, -1, None)
serial, monitors, logical, props = call('GetCurrentState', None, None).unpack()
logical_monitors = []
x = 0
for (connector, *_), modes, _ in monitors[:len(sys.argv) - 1]:
    wanted = float(sys.argv[1 + len(logical_monitors)])
    mode = next(m for m in modes if m[6].get('is-current'))
    scale = min(mode[5], key=lambda s: abs(s - wanted))
    logical_monitors.append((x, 0, scale, 0, not logical_monitors, [(connector, mode[0], {})]))
    x += round(mode[1] / scale)
call('ApplyMonitorsConfig', GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', (serial, 1, logical_monitors, {})), None)
print('scales', [round(m[2], 3) for m in logical_monitors])
