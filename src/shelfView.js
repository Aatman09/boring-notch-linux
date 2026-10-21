import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

// The mimetype a file manager uses for copied files: one URI per line.
const URI_LIST = 'text/uri-list';
const QUERY = 'standard::display-name,standard::icon,thumbnail::path';

const chip = (label, callback) => {
    const button = new St.Button({style_class: 'bn-chip', label, can_focus: true});
    button.connect('clicked', callback);
    return button;
};

// Opens the file in the app GNOME picks for it.
function openFile(file) {
    try {
        Gio.AppInfo.launch_default_for_uri(file.get_uri(), global.create_app_launch_context(0, -1));
    } catch (e) {
        console.warn(`Boring Notch: cannot open ${file.get_path()}: ${e.message}`);
    }
}

// Selects the file in the file manager, or opens its folder when no file
// manager answers on the session bus.
function showInFolder(file) {
    Gio.DBus.session.call('org.freedesktop.FileManager1', '/org/freedesktop/FileManager1',
        'org.freedesktop.FileManager1', 'ShowItems',
        new GLib.Variant('(ass)', [[file.get_uri()], '']),
        null, Gio.DBusCallFlags.NONE, -1, null, (bus, result) => {
            try {
                bus.call_finish(result);
            } catch (e) {
                openFile(file.get_parent());
            }
        });
}

// The local file paths in a text/uri-list or a plain list of paths. Lines
// that are not existing regular files are left out.
function filePaths(text) {
    return text.split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => {
            if (line.startsWith('file://'))
                return Gio.File.new_for_uri(line).get_path();
            return line.startsWith('/') ? line : null;
        })
        .filter(path => path && GLib.file_test(path, GLib.FileTest.IS_REGULAR));
}

/**
 * The Shelf tab: the files on the shelf, one per row with its icon or
 * thumbnail, name and Open, Show in folder and Remove. Paste takes the files
 * copied in a file manager.
 */
export const ShelfView = GObject.registerClass(
class ShelfView extends St.BoxLayout {
    _init({shelf}) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-shelf',
            x_expand: true,
            y_expand: true,
        });
        this._shelf = shelf;

        const bar = new St.BoxLayout({style_class: 'bn-shelf-bar'});
        this._count = new St.Label({style_class: 'bn-shelf-count', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._count.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        bar.add_child(this._count);
        bar.add_child(chip('Paste', () => this._paste()));
        bar.add_child(chip('Clear', () => this._shelf.clear()));
        this.add_child(bar);

        this._list = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'bn-shelf-list'});
        const scroll = new St.ScrollView({
            style_class: 'bn-shelf-scroll',
            overlay_scrollbars: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            x_expand: true,
            y_expand: true,
            child: this._list,
        });
        this.add_child(scroll);

        this._shelf.connectObject('changed', () => this._rebuild(), this);
        this._rebuild();
    }

    // Called when the tab opens: files moved or deleted since then leave.
    reset() {
        this._shelf.prune();
    }

    _paste() {
        const clipboard = St.Clipboard.get_default();
        clipboard.get_content(St.ClipboardType.CLIPBOARD, URI_LIST, (_c, bytes) => {
            const text = bytes ? new TextDecoder().decode(bytes.toArray()) : '';
            if (text.trim())
                this._addPaths(text);
            else
                clipboard.get_text(St.ClipboardType.CLIPBOARD, (_t, plain) => this._addPaths(plain ?? ''));
        });
    }

    _addPaths(text) {
        const paths = filePaths(text);
        if (paths.length === 0) {
            this._count.text = 'No files in the clipboard';
            return;
        }
        // Added last to first, so the first file pasted ends up newest.
        for (const path of paths.reverse())
            this._shelf.add(path);
    }

    _rebuild() {
        this._list.destroy_all_children();
        const paths = this._shelf.paths;
        this._count.text = paths.length > 0
            ? `${paths.length} on the shelf`
            : 'Copy files in the file manager, then press Paste';
        for (const path of paths) {
            const row = this._row(path);
            if (row)
                this._list.add_child(row);
        }
    }

    // A row for a file that still exists; null for one that does not.
    _row(path) {
        const file = Gio.File.new_for_path(path);
        let info;
        try {
            info = file.query_info(QUERY, Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            return null;
        }
        const thumbnail = info.get_attribute_byte_string('thumbnail::path');
        const icon = thumbnail ? Gio.FileIcon.new(Gio.File.new_for_path(thumbnail)) : info.get_icon();

        const row = new St.BoxLayout({style_class: 'bn-shelf-row', x_expand: true});
        row.add_child(new St.Icon({gicon: icon, style_class: 'bn-shelf-icon', y_align: Clutter.ActorAlign.CENTER}));
        const name = new St.Label({
            text: info.get_display_name(),
            style_class: 'bn-shelf-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(name);
        row.add_child(chip('Open', () => openFile(file)));
        row.add_child(chip('Show in folder', () => showInFolder(file)));
        row.add_child(chip('Remove', () => this._shelf.remove(path)));
        return row;
    }
});
