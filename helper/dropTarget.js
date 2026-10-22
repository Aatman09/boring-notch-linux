// The drop target for the notch's shelf. GNOME Shell sees a drag pass over
// the notch but is never given the files: on Wayland only an app's window
// can take a drop. This small app is that window. The extension starts it
// when a drag begins, places it under the open notch, and reads what it
// prints, one JSON line per event: {"event": "ready" | "enter" | "leave"},
// and {"event": "drop", "paths": [...]}. It quits after a drop.
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

// The extension finds this window by its app id.
const APP_ID = 'io.github.aatman09.BoringNotchDrop';

const say = message => print(JSON.stringify(message));

const app = new Gtk.Application({application_id: APP_ID, flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const window = new Gtk.Window({
        application: app,
        title: 'Boring Notch drop target',
        decorated: false,
        default_width: 640,
        default_height: 190,
    });
    const target = new Gtk.DropTarget({actions: Gdk.DragAction.COPY});
    target.set_gtypes([Gdk.FileList.$gtype]);
    target.connect('enter', () => {
        say({event: 'enter'});
        return Gdk.DragAction.COPY;
    });
    target.connect('leave', () => say({event: 'leave'}));
    target.connect('drop', (_target, files) => {
        const paths = files.get_files().map(file => file.get_path()).filter(path => path);
        say({event: 'drop', paths});
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
        return true;
    });
    window.add_controller(target);
    // Nearly invisible, and placed under the opaque notch anyway. A window
    // whose background is fully transparent is never shown by GNOME, so
    // the whole window is faded instead.
    window.set_opacity(0.004);
    window.present();
    say({event: 'ready'});
});
app.run([]);
