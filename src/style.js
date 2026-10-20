import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/**
 * Loads src/style.css with every pixel length multiplied by the zoom. St
 * has no zoom of its own, so the scaled sheet is written to a cache file
 * and loaded in place of the original.
 *
 * Lengths are rounded to whole pixels: icons in particular render badly at
 * fractional sizes. Font sizes keep one decimal.
 */
export class ScaledStylesheet {
    constructor(template, zoom) {
        const [, contents] = template.load_contents(null);
        this._template = decoder.decode(contents);
        this._zoom = zoom;
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'boring-notch-linux']);
        this._generation = 0;

        zoom.connectObject('changed', () => this._load(), this);
        this._load();
    }

    _load() {
        const zoom = this._zoom.value;
        if (zoom === this._loadedZoom)
            return;
        this._loadedZoom = zoom;

        const css = this._template.replace(/([\w-]+)(\s*:\s*)([^;{}]*)/g, (decl, property, colon, value) => {
            const scaled = value.replace(/(\d*\.?\d+)px/g, (_m, number) => {
                const px = parseFloat(number) * zoom;
                if (property === 'font-size')
                    return `${+px.toFixed(1)}px`;
                return `${px > 0 ? Math.max(1, Math.round(px)) : 0}px`;
            });
            return `${property}${colon}${scaled}`;
        });

        // A new name each time, because St caches stylesheets by file.
        GLib.mkdir_with_parents(this._dir, 0o700);
        const file = Gio.File.new_for_path(
            GLib.build_filenamev([this._dir, `style-${this._generation++}.css`]));
        file.replace_contents(encoder.encode(css), null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null);

        const theme = St.ThemeContext.get_for_stage(global.stage).get_theme();
        this._unload();
        theme.load_stylesheet(file);
        this._file = file;
    }

    _unload() {
        if (!this._file)
            return;
        St.ThemeContext.get_for_stage(global.stage).get_theme().unload_stylesheet(this._file);
        this._file.delete_async(GLib.PRIORITY_LOW, null, null);
        this._file = null;
    }

    destroy() {
        this._zoom.disconnectObject(this);
        this._unload();
    }
}
