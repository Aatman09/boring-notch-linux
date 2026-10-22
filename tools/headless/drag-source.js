// A window to drag a file from, for drop.sh: everything in it drags the
// file named on the command line, the way a file manager offers it.
// Usage: gjs -m drag-source.js /path/to/file
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

const file = Gio.File.new_for_path(ARGV[0]);
const app = new Gtk.Application({application_id: 'io.github.aatman09.BoringNotchDragSource', flags: Gio.ApplicationFlags.NON_UNIQUE});
app.connect('activate', () => {
    const window = new Gtk.Window({application: app, title: 'Drag source', default_width: 300, default_height: 200});
    const label = new Gtk.Label({label: file.get_basename(), hexpand: true, vexpand: true});
    window.set_child(label);
    const source = new Gtk.DragSource({actions: Gdk.DragAction.COPY});
    source.connect('prepare', () => Gdk.ContentProvider.new_for_bytes('text/uri-list',
        new GLib.Bytes(new TextEncoder().encode(`${file.get_uri()}\r\n`))));
    source.connect('drag-end', (_s, _drag, deleteData) => print(`drag-end ${deleteData}`));
    label.add_controller(source);
    window.present();
});
app.run([]);
