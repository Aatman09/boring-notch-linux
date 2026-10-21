import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import St from 'gi://St';

/** Rounded album cover, with a music note while there is no art. */
export const AlbumArt = GObject.registerClass(
class AlbumArt extends St.Bin {
    _init(styleClass) {
        // The cover keeps its size from the stylesheet: expanding would let
        // it take spare width from the row around it. Scaling runs about
        // the centre, for the paused state of the open player.
        super._init({
            style_class: styleClass,
            x_expand: false,
            y_expand: false,
            y_align: Clutter.ActorAlign.CENTER,
            pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
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

    // Tint from the album art: one inline background-colour per bar, or
    // the stylesheet's when there is none.
    setColor(rgb) {
        const style = rgb
            ? `background-color: rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]});`
            : null;
        for (const bar of this._bars)
            bar.style = style;
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

// Opens a panel of GNOME's Settings, such as 'power' or 'privacy'.
export function openSettingsPanel(panel) {
    try {
        Gio.Subprocess.new(['gnome-control-center', panel], Gio.SubprocessFlags.NONE);
    } catch (e) {
        console.warn(`Boring Notch: cannot open the ${panel} settings: ${e.message}`);
    }
}

// Long titles scroll instead of being cut off. The head is shown for this
// long before each pass, so it can be read again, and the gap is what
// trails behind the tail as it slides out.
const SCROLL_WAIT_MS = 1000;
const SCROLL_GAP = 24;
// Scrolling runs at this many pixels per second, so a longer title takes
// proportionally longer over its single pass.
const SCROLL_SPEED = 30;
const SCROLL_PASSES = 2;

/**
 * The marquee's own layout. The label gets its content height, centred in
 * the box, and either the box's start with its natural width while
 * scrolling — wider than the clip, so it slides out — or the box's width,
 * so the stylesheet's ellipsis shows.
 */
const MarqueeLayout = GObject.registerClass(
class MarqueeLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(actor, forHeight) {
        const label = actor.first_child;
        if (!label)
            return [0, 0];
        const [min, natural] = label.get_preferred_width(forHeight);
        return label.get_theme_node().adjust_preferred_width(min, natural);
    }

    vfunc_get_preferred_height(actor, forWidth) {
        const label = actor.first_child;
        if (!label)
            return [0, 0];
        const [min, natural] = label.get_preferred_height(forWidth);
        return label.get_theme_node().adjust_preferred_height(min, natural);
    }

    vfunc_allocate(actor, box) {
        const label = actor.first_child;
        if (!label)
            return;
        const width = box.get_width();
        const height = box.get_height();
        const node = label.get_theme_node();
        const fill = label.x_align === Clutter.ActorAlign.FILL;
        const contentWidth = fill ? width : label.get_preferred_width(-1)[1];

        const marginTop = node.get_margin(St.Side.TOP);
        const marginBottom = node.get_margin(St.Side.BOTTOM);

        // Margins belong between the box and the text, in the vertical
        // axis too, where a margin pushes the line out of reach.
        const spare = Math.max(0, height - marginTop - marginBottom);
        const [, lineH] = label.get_preferred_height(contentWidth);
        const top = marginTop + (spare - Math.min(lineH, spare)) / 2;

        const childBox = new Clutter.ActorBox();
        childBox.set_origin(box.x1, box.y1 + top);
        childBox.set_size(contentWidth, lineH);
        label.allocate(childBox);
    }
});

/**
 * A label that scrolls when it is wider than its space, twice per track,
 * and only while scrolling is active. Without it much longer titles are
 * shown with an ellipsis, like a plain label.
 */
export const MarqueeLabel = GObject.registerClass(
class MarqueeLabel extends St.Widget {
    _init(styleClass, widgetClass = null) {
        super._init({
            layout_manager: new MarqueeLayout(),
            clip_to_allocation: true,
            style_class: widgetClass,
        });
        // Start-aligned while scrolling, so the label keeps its natural
        // width past the clip and has somewhere to come from; filled
        // otherwise, so the ellipsis works as a label's does.
        this._label = new St.Label({
            style_class: styleClass,
            x_align: Clutter.ActorAlign.FILL,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this._label);
        this._scrolling = false;
        this._running = false;
        this._seq = 0;
        this._sources = new Set();
        this.connect('notify::allocation', () => this._sync());
        this.connect('destroy', () => this._stop());
    }

    // A new track: its two passes start over.
    set(text) {
        this._label.text = text;
        this._stop();
        this._sync();
    }

    setScrolling(active) {
        if (active === this._scrolling)
            return;
        this._scrolling = active;
        this._stop();
        this._sync();
    }

    // Stops a run where it is, at the head, without waiting.
    _stop() {
        for (const id of [...this._sources])
            GLib.source_remove(id);
        this._sources.clear();
        this._seq++;
        this._running = false;
        this._label.remove_all_transitions();
        this._label.translation_x = 0;
    }

    _sync() {
        // Combining alignment with the redraws of a run would fight it;
        // the label only settles between tracks.
        this._label.x_align = this._scrolling
            ? Clutter.ActorAlign.START : Clutter.ActorAlign.FILL;
        if (!this._scrolling || this._running)
            return;
        // Measuring off the stage has no theme node; allocation comes in
        // once it is on one. A positive allocation is a layout that ran.
        const width = this.allocation.get_width();
        if (!(width > 0))
            return;
        const [, natural] = this._label.get_preferred_width(-1);
        const overflow = natural - width;
        if (!(overflow > 0))
            return;
        this._running = true;
        this._run(overflow, this._seq);
    }

    // Two passes: read the head, slide out to the tail, read it, then jump
    // back to the head. A stop or a new track leaves it at the head.
    async _run(overflow, seq) {
        const distance = overflow + SCROLL_GAP;
        const duration = Math.round(distance / SCROLL_SPEED * 1000);
        try {
            for (let pass = 0; pass < SCROLL_PASSES; pass++) {
                if (!(await this._wait(SCROLL_WAIT_MS, seq)) ||
                    !(await this._ease(-distance, duration, seq)) ||
                    !(await this._wait(SCROLL_WAIT_MS, seq)))
                    return;
                this._label.translation_x = 0;
            }
        } finally {
            if (seq === this._seq)
                this._running = false;
        }
    }

    _wait(ms, seq) {
        return new Promise(resolve => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._sources.delete(id);
                resolve(seq === this._seq);
            });
            this._sources.add(id);
        });
    }

    _ease(target, duration, seq) {
        return new Promise(resolve => {
            if (seq !== this._seq) {
                resolve(false);
                return;
            }
            this._label.ease({
                translation_x: target,
                duration,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onStopped: finished => resolve(seq === this._seq && finished),
            });
        });
    }
});
