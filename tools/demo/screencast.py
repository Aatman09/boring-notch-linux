# Records an area of the headless shell with GNOME's own screencast, from
# start to stop on one D-Bus connection: GNOME stops a screencast when the
# program that started it goes away.
# Usage: python3 -I screencast.py X Y WIDTH HEIGHT OUT.mp4 SECONDS
import sys
import time
from gi.repository import Gio, GLib

x, y, width, height = (int(v) for v in sys.argv[1:5])
out, seconds = sys.argv[5], float(sys.argv[6])
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)


def call(method, args, reply):
    return bus.call_sync('org.gnome.Shell.Screencast', '/org/gnome/Shell/Screencast',
                         'org.gnome.Shell.Screencast', method, args,
                         GLib.VariantType(reply), Gio.DBusCallFlags.NONE, -1, None).unpack()


options = {'framerate': GLib.Variant('u', 60), 'draw-cursor': GLib.Variant('b', True)}
ok, path = call('ScreencastArea', GLib.Variant('(iiiisa{sv})', (x, y, width, height, out, options)), '(bs)')
print('recording' if ok else 'failed', path, flush=True)
time.sleep(seconds)
call('StopScreencast', None, '(b)')
time.sleep(1)
print('done', flush=True)
