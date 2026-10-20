import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

/** Rounded album cover, with a music note while there is no art. */
export const AlbumArt = GObject.registerClass(
class AlbumArt extends St.Bin {
    _init(styleClass) {
        // The cover keeps its size from the stylesheet: expanding would let
        // it take spare width from the row around it.
        super._init({
            style_class: styleClass,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._placeholder = new St.Icon({
            icon_name: 'folder-music-symbolic',
            style_class: `${styleClass}-placeholder`,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
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

// Without real audio, bars move in steps rather than eased transitions:
// easing makes the shell redraw every frame while music plays, which cost
// about 10% of a CPU core. At this rate a redraw happens only a few times a
// second.
const VISUALIZER_STEP_MS = 120;
// How far a bar can fall per audio update. Bars jump up to a new level at
// once and fall back slowly, like a level meter.
const AUDIO_DECAY = 0.06;
const RESTING_SCALE = 0.25;

/**
 * The bouncing bars from AudioSpectrumView: bass to treble when following
 * the audio, otherwise moving on their own like boring.notch's.
 */
export const Visualizer = GObject.registerClass(
class Visualizer extends St.BoxLayout {
    _init(audio) {
        super._init({
            style_class: 'bn-visualizer',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._audio = audio;
        this._audioFailed = false;
        this._mode = null;
        this._bars = [];
        for (let i = 0; i < 4; i++) {
            const bar = new St.Widget({
                style_class: 'bn-visualizer-bar',
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                scale_y: RESTING_SCALE,
            });
            bar._target = RESTING_SCALE;
            bar._level = 0;
            this.add_child(bar);
            this._bars.push(bar);
        }
        this.connect('destroy', () => this._setMode(null));
    }

    set_playing(playing, followAudio = false) {
        if (!playing)
            this._audioFailed = false;
        const useAudio = followAudio && this._audio && !this._audioFailed;
        this._setMode(playing ? useAudio ? 'audio' : 'random' : null);
    }

    _setMode(mode) {
        if (mode === this._mode)
            return;

        if (this._mode === 'audio') {
            this._audio.disconnectObject(this);
            this._audio.stop();
        } else if (this._mode === 'random') {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        this._mode = mode;

        if (mode === 'audio') {
            this._audio.connectObject(
                'levels', (_a, levels) => this._showLevels(levels),
                'failed', () => {
                    this._audioFailed = true;
                    this._setMode('random');
                },
                this);
            this._audio.start();
        } else if (mode === 'random') {
            this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, VISUALIZER_STEP_MS, () => {
                this._step();
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this._bars.forEach(bar => {
                bar.scale_y = RESTING_SCALE;
                bar._level = 0;
            });
        }
    }

    _showLevels(levels) {
        this._bars.forEach((bar, i) => {
            bar._level = Math.max(levels[i] ?? 0, bar._level - AUDIO_DECAY);
            bar.scale_y = 0.2 + 0.8 * bar._level;
        });
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
