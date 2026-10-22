import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import {ShareTargets} from './share.js';

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
 * thumbnail, name and Open, Show in folder, Share and Remove. Paste takes
 * the files copied in a file manager. With clipboard-history on, a Files |
 * Clipboard toggle switches to the text copied recently, and a click on a
 * copied text copies it again.
 */
export const ShelfView = GObject.registerClass(
class ShelfView extends St.BoxLayout {
    _init({settings, shelf, clipboard}) {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-shelf',
            x_expand: true,
            y_expand: true,
        });
        this._settings = settings;
        this._shelf = shelf;
        this._clipboard = clipboard;
        this._mode = 'files';
        // The file whose share targets are open, if any.
        this._sharePath = null;
        // Whether dragged files are over the shelf (see setDropHover).
        this._dropHover = false;
        // Cancels the file queries of the rows of the last build.
        this._rowsCancellable = null;
        this._shareTargets = new ShareTargets();
        this._shareTargets.connectObject('changed', () => this._rebuild(), this);

        const bar = new St.BoxLayout({style_class: 'bn-shelf-bar'});
        this._modes = new St.BoxLayout({style_class: 'bn-shelf-modes'});
        this._filesChip = chip('Files', () => this._setMode('files'));
        this._clipboardChip = chip('Clipboard', () => this._setMode('clipboard'));
        this._modes.add_child(this._filesChip);
        this._modes.add_child(this._clipboardChip);
        bar.add_child(this._modes);
        this._count = new St.Label({style_class: 'bn-shelf-count', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        this._count.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        bar.add_child(this._count);
        this._pasteButton = chip('Paste', () => this._pasteFiles());
        this._clearButton = chip('Clear', () => this._clearMode());
        bar.add_child(this._pasteButton);
        bar.add_child(this._clearButton);
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
        this._clipboard.connectObject('changed', () => {
            if (this._mode === 'clipboard')
                this._rebuild();
        }, this);
        settings.connectObject(
            'changed::shelf-share', () => this._rebuild(),
            'changed::clipboard-history', () => this._rebuild(),
            this);
        this.connect('destroy', () => {
            this._rowsCancellable?.cancel();
            this._shareTargets.destroy();
        });
        this._rebuild();
    }

    // While dragged files are over the shelf, it says a drop adds them.
    setDropHover(hover) {
        if (hover)
            this.add_style_class_name('bn-shelf-drop');
        else
            this.remove_style_class_name('bn-shelf-drop');
        this._dropHover = hover;
        this._rebuild();
    }

    // Called when the tab opens: files moved or deleted since then leave,
    // and the share targets are looked for again.
    reset() {
        this._shelf.prune();
        if (this._settings.get_boolean('shelf-share'))
            this._shareTargets.refresh();
    }

    _setMode(mode) {
        this._mode = mode;
        this._sharePath = null;
        this._rebuild();
    }

    _clearMode() {
        if (this._mode === 'clipboard')
            this._clipboard.clear();
        else
            this._shelf.clear();
    }

    _rebuild() {
        this._rowsCancellable?.cancel();
        this._rowsCancellable = new Gio.Cancellable();
        this._list.destroy_all_children();
        const history = this._settings.get_boolean('clipboard-history');
        if (!history)
            this._mode = 'files';
        this._modes.visible = history;
        this._filesChip.checked = this._mode === 'files';
        this._clipboardChip.checked = this._mode === 'clipboard';
        this._pasteButton.visible = this._mode === 'files';

        if (this._mode === 'clipboard') {
            this._rebuildClipboard();
            return;
        }
        const paths = this._shelf.paths;
        this._count.text = this._dropHover ? 'Drop to add to the shelf' : paths.length > 0
            ? `${paths.length} on the shelf`
            : 'Copy files in the file manager, then press Paste';
        // Share buttons show only when there is something to share to.
        this._canShare = this._settings.get_boolean('shelf-share') &&
            this._shareTargets.targets.length > 0;
        for (const path of paths)
            this._list.add_child(this._row(path, this._rowsCancellable));
    }

    _rebuildClipboard() {
        const entries = this._clipboard.entries;
        this._count.text = entries.length > 0
            ? `${entries.length} copied, newest first`
            : 'Text you copy appears here';
        for (const text of entries) {
            const label = new St.Label({
                text: text.replace(/\s+/g, ' ').trim(),
                style_class: 'bn-shelf-clip-text',
                x_expand: true,
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const entry = new St.Button({style_class: 'bn-shelf-clip', child: label, can_focus: true, x_expand: true});
            entry.connect('clicked', () => St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text));
            this._list.add_child(entry);
        }
    }

    _pasteFiles() {
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

    // Opens the share targets under a file, or closes them when they are open.
    _toggleShare(path) {
        this._sharePath = this._sharePath === path ? null : path;
        this._rebuild();
    }

    // The targets found now, one button each. Sending closes them.
    _shareRow(path) {
        const row = new St.BoxLayout({style_class: 'bn-shelf-share'});
        for (const target of this._shareTargets.targets) {
            row.add_child(chip(target.label, () => {
                try {
                    target.send([path]);
                } catch (e) {
                    console.warn(`Boring Notch: cannot share with ${target.label}: ${e.message}`);
                }
                this._toggleShare(path);
            }));
        }
        return row;
    }

    // A row for a file. Its name and icon are filled in once the file has
    // been asked about, off the main loop's hot path; a file that is gone
    // hides its row.
    _row(path, cancellable) {
        const file = Gio.File.new_for_path(path);
        const icon = new St.Icon({
            icon_name: 'text-x-generic-symbolic',
            style_class: 'bn-shelf-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const row = new St.BoxLayout({style_class: 'bn-shelf-row', x_expand: true});
        row.add_child(icon);
        const name = new St.Label({
            text: GLib.path_get_basename(path),
            style_class: 'bn-shelf-name',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        name.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        row.add_child(name);
        row.add_child(chip('Open', () => openFile(file)));
        row.add_child(chip('Show in folder', () => showInFolder(file)));
        if (this._canShare)
            row.add_child(chip('Share', () => this._toggleShare(path)));
        row.add_child(chip('Remove', () => this._shelf.remove(path)));

        const item = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        item.add_child(row);
        if (this._sharePath === path)
            item.add_child(this._shareRow(path));

        file.query_info_async(QUERY, Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_DEFAULT, cancellable, (f, result) => {
            let info;
            try {
                info = f.query_info_finish(result);
            } catch (e) {
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    item.hide();
                return;
            }
            const thumbnail = info.get_attribute_byte_string('thumbnail::path');
            icon.gicon = thumbnail ? Gio.FileIcon.new(Gio.File.new_for_path(thumbnail)) : info.get_icon();
            name.text = info.get_display_name();
        });
        return item;
    }
});
