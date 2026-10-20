import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

/** Rounded album cover, with a music note while there is no art. */
export const AlbumArt = GObject.registerClass(
class AlbumArt extends St.Bin {
    _init(styleClass) {
        super._init({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
        this._placeholder = new St.Icon({
            icon_name: 'folder-music-symbolic',
            style_class: `${styleClass}-placeholder`,
            x_expand: true,
            y_expand: true,
        });
        this.set_art(null);
        this.connect('destroy', () => {
            if (!this._placeholder.get_parent())
                this._placeholder.destroy();
        });
    }

    set_art(uri) {
        if (uri) {
            this.style = `background-image: url("${uri}");`;
            this.child = null;
        } else {
            this.style = null;
            this.child = this._placeholder;
        }
    }
});

// Bars move in steps rather than eased transitions: easing makes the shell
// redraw every frame while music plays, which cost about 10% of a CPU core.
// At this rate a redraw happens only a few times a second.
const VISUALIZER_STEP_MS = 120;

/**
 * The bouncing bars from AudioSpectrumView. Like boring.notch these move
 * randomly while music plays rather than following the audio.
 */
export const Visualizer = GObject.registerClass(
class Visualizer extends St.BoxLayout {
    _init() {
        super._init({
            style_class: 'bn-visualizer',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._bars = [];
        for (let i = 0; i < 4; i++) {
            const bar = new St.Widget({
                style_class: 'bn-visualizer-bar',
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                scale_y: 0.25,
            });
            bar._target = 0.25;
            this.add_child(bar);
            this._bars.push(bar);
        }
        this.connect('destroy', () => this.set_playing(false));
    }

    set_playing(playing) {
        if (playing === !!this._timeoutId)
            return;

        if (playing) {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VISUALIZER_STEP_MS, () => {
                this._step();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
            this._bars.forEach(bar => (bar.scale_y = 0.25));
        }
    }

    // Each bar heads halfway to its target every step and picks a new
    // target once it gets close, which looks like a bounce.
    _step() {
        for (const bar of this._bars) {
            if (Math.abs(bar.scale_y - bar._target) < 0.08)
                bar._target = 0.3 + Math.random() * 0.7;
            bar.scale_y += (bar._target - bar.scale_y) / 2;
        }
    }
});

/** Formats microseconds as m:ss. */
export function formatTime(us) {
    const total = Math.max(0, Math.floor(us / GLib.USEC_PER_SEC));
    const minutes = Math.floor(total / 60);
    const seconds = String(total % 60).padStart(2, '0');
    return `${minutes}:${seconds}`;
}
