# Sets the headless session's display scale. Usage: python3 -I set-scale.py 1.25
import sys
from gi.repository import Gio, GLib
bus = Gio.bus_get_sync(Gio.BusType.SESSION)
call = lambda m, a, t: bus.call_sync('org.gnome.Mutter.DisplayConfig', '/org/gnome/Mutter/DisplayConfig',
    'org.gnome.Mutter.DisplayConfig', m, a, t, Gio.DBusCallFlags.NONE, -1, None)
serial, monitors, logical, props = call('GetCurrentState', None, None).unpack()
(connector, *_), modes, _ = monitors[0]
mode = next(m for m in modes if m[6].get('is-current'))
scale = min(mode[5], key=lambda s: abs(s - float(sys.argv[1])))
call('ApplyMonitorsConfig', GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})',
    (serial, 1, [(0, 0, scale, 0, True, [(connector, mode[0], {})])], {})), None)
print('scale', scale)
