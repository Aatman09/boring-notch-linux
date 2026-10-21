import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {AlbumArt, MarqueeLabel, formatTime, iconButton} from './widgets.js';

const SKIP_SECONDS = 15;
const PAUSED_EASE_MS = 200;

// The buttons the player row can show, in the order of the setting.
const PLAYER_BUTTONS = {
    'shuffle': {icon: 'media-playlist-shuffle-symbolic', style: 'bn-toggle', press: p => p.toggleShuffle()},
    'previous': {icon: 'media-skip-backward-symbolic', press: p => p.previous()},
    'back-15': {icon: 'media-seek-backward-symbolic', press: p => p.skip(-SKIP_SECONDS)},
    'play-pause': {icon: 'media-playback-start-symbolic', style: 'bn-play', press: p => p.playPause()},
    'forward-15': {icon: 'media-seek-forward-symbolic', press: p => p.skip(SKIP_SECONDS)},
    'next': {icon: 'media-skip-forward-symbolic', press: p => p.next()},
    'repeat': {icon: 'media-playlist-repeat-symbolic', style: 'bn-toggle', press: p => p.cycleLoop()},
};

/**
 * The cover with its glow: the box is the cover's size, so the row lays out
 * as if there were no glow, and the glow is centred on the cover at its own
 * larger size, spilling over the box.
 */
const ArtLayout = GObject.registerClass(
class ArtLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width(container, forHeight) {
        return container.last_child?.get_preferred_width(forHeight) ?? [0, 0];
    }

    vfunc_get_preferred_height(container, forWidth) {
        return container.last_child?.get_preferred_height(forWidth) ?? [0, 0];
    }

    vfunc_allocate(container, box) {
        const [glow, art] = container.get_children();
        art.allocate(box);
        const [, width] = glow.get_preferred_width(-1);
        const [, height] = glow.get_preferred_height(-1);
        const glowBox = new Clutter.ActorBox();
        glowBox.set_origin(
            Math.round((box.x1 + box.x2 - width) / 2),
            Math.round((box.y1 + box.y2 - height) / 2));
        glowBox.set_size(width, height);
        glow.allocate(glowBox);
    }
});

/** The music player from NotchHomeView. */
export const MediaPlayer = GObject.registerClass(
class MediaPlayer extends St.BoxLayout {
    _init(settings, lyrics) {
        super._init({style_class: 'bn-player', x_expand: true, y_expand: true});

        // The cover, with a blurred enlarged copy glowing behind it while
        // the track plays; paused, the cover itself shrinks and dims.
        this._artBox = new St.Widget({
            layout_manager: new ArtLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            reactive: true,
        });
        // A blurred, enlarged copy of the cover glows around the cover;
        // it is faint and bigger than the cover, about its centre.
        this._glow = new St.Widget({
            style_class: 'bn-art-glow',
            visible: false,
            opacity: 128,
        });
        this._glow.add_effect(new Shell.BlurEffect({radius: 40, mode: Shell.BlurMode.ACTOR}));
        this._art = new AlbumArt('bn-art');
        this._artBox.add_child(this._glow);
        this._artBox.add_child(this._art);
        this._artBox.connect('button-press-event', () => {
            this._player?.raise();
            return Clutter.EVENT_STOP;
        });
        this.add_child(this._artBox);

        const column = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-player-column',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(column);

        this._title = new MarqueeLabel('bn-title');
        this._artist = new MarqueeLabel('bn-artist');
        // The lyric line that is sung now, when the setting shows lyrics.
        this._lyric = new St.Label({style_class: 'bn-lyric', visible: false});
        this._lyric.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        column.add_child(this._title);
        column.add_child(this._artist);
        column.add_child(this._lyric);

        this._slider = new Slider.Slider(0);
        this._slider.add_style_class_name('bn-progress');
        this._slider.x_expand = true;
        this._slider.connect('drag-begin', () => {
            this.dragging = true;
        });
        this._slider.connect('drag-end', () => {
            this.dragging = false;
            this._player?.seek(this._slider.value);
        });
        // Clicks and scrolls on the bar change the value without a drag.
        this._slider.connect('notify::value', () => {
            if (this._syncing)
                return;
            if (this.dragging)
                this._syncTimes(this._slider.value * (this._player?.length ?? 0));
            else
                this._player?.seek(this._slider.value);
        });
        column.add_child(this._slider);

        const times = new St.BoxLayout({style_class: 'bn-times'});
        this._elapsed = new St.Label({style_class: 'bn-time'});
        this._remaining = new St.Label({style_class: 'bn-time', x_expand: true, x_align: Clutter.ActorAlign.END});
        times.add_child(this._elapsed);
        times.add_child(this._remaining);
        column.add_child(times);

        this._controls = new St.BoxLayout({style_class: 'bn-controls', x_align: Clutter.ActorAlign.CENTER});
        column.add_child(this._controls);
        this._settings = settings;
        this._lyrics = lyrics;
        this._buttons = {};
        this._scrollOpen = false;
        this._playing = null;
        settings.connectObject(
            'changed::player-buttons', () => this._buildControls(),
            'changed::scroll-titles', () => this._syncScrolling(),
            'changed::art-glow', () => {
                this._playing = null;
                this._syncPlaying(this._player?.playing ?? false);
            },
            this);
        this._buildControls();

        this.dragging = false;
    }

    _buildControls() {
        this._controls.destroy_all_children();
        this._buttons = {};
        for (const id of this._settings.get_strv('player-buttons')) {
            const spec = PLAYER_BUTTONS[id];
            if (!spec || this._buttons[id])
                continue;
            this._buttons[id] = iconButton(spec.icon, spec.style ?? '', () => {
                if (this._player)
                    spec.press(this._player);
            });
            this._controls.add_child(this._buttons[id]);
        }
        if (this._player)
            this._syncButtons(this._player);
    }

    update(player, artUri) {
        this._player = player;
        this._art.set_art(artUri);
        this._glow.style = artUri ? `background-image: url("${artUri}");` : null;
        this._title.set(player.title);
        this._artist.set(player.artists || player.identity);
        this._slider.reactive = player.canSeek;
        this._syncButtons(player);
        this._syncPlaying(player.playing);
        this.tick();
        // A new track's lyric goes at once, even while paused, where tick()
        // would leave the old line showing.
        this._syncLyric(player.position);
    }

    // The glow shows while the track plays; paused, the cover eases to a
    // smaller, dimmed copy. Both animate only here, on a state change.
    _syncPlaying(playing) {
        if (playing === this._playing)
            return;
        this._playing = playing;
        this._glow.visible = playing && this._settings.get_boolean('art-glow');
        this._art.ease({
            scale_x: playing ? 1.0 : 0.85,
            scale_y: playing ? 1.0 : 0.85,
            opacity: playing ? 255 : 153,
            duration: PAUSED_EASE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
        });
    }

    _syncButtons(player) {
        const b = this._buttons;
        if (b['play-pause']) {
            b['play-pause'].child.icon_name = player.playing
                ? 'media-playback-pause-symbolic'
                : 'media-playback-start-symbolic';
        }
        if (b.previous)
            b.previous.reactive = player.canGoPrevious;
        if (b.next)
            b.next.reactive = player.canGoNext;
        for (const id of ['back-15', 'forward-15']) {
            if (b[id])
                b[id].reactive = player.canSeek;
        }
        if (b.shuffle)
            b.shuffle.checked = player.shuffle;
        if (b.repeat) {
            b.repeat.checked = player.loopStatus !== 'None';
            b.repeat.child.icon_name = player.loopStatus === 'Track'
                ? 'media-playlist-repeat-song-symbolic'
                : 'media-playlist-repeat-symbolic';
        }
    }

    tick() {
        if (!this._player || this.dragging)
            return;
        const {position, length} = this._player;
        this._syncing = true;
        this._slider.value = length > 0 ? position / length : 0;
        this._syncing = false;
        this._syncTimes(position);
        if (this._player.playing)
            this._syncLyric(position);
    }

    _syncLyric(position) {
        const line = this._lyrics.lineAt(position);
        if (line === this._lyric.text)
            return;
        this._lyric.text = line;
        this._lyric.visible = line !== '';
    }

    _syncTimes(position) {
        const length = this._player?.length ?? 0;
        this._elapsed.text = formatTime(position);
        this._remaining.text = length > 0 ? `-${formatTime(length - position)}` : '';
    }

    // Long titles scroll while the notch is open on Home, and never while
    // the notch is closed or the page is parked, however wide they are.
    setScrolling(active) {
        this._scrollOpen = active;
        this._syncScrolling();
    }

    _syncScrolling() {
        const on = this._scrollOpen && this._settings.get_boolean('scroll-titles');
        for (const label of [this._title, this._artist])
            label.setScrolling(on);
    }

    // The cover's colour tints the secondary text and the played part of
    // the seek bar; null takes the stylesheet's colours back. The active
    // fill is a style property of BarLevel, the class under the slider, so
    // a plain inline style is enough.
    setColor(rgb) {
        const color = rgb ? `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})` : null;
        for (const label of [this._artist, this._lyric, this._elapsed, this._remaining])
            label.style = color ? `color: ${color};` : null;
        this._slider.style = color
            ? `-barlevel-active-background-color: ${color};`
            : null;
    }
});

/** What the notch shows when nothing is playing: the time and date. */
export const IdleView = GObject.registerClass(
class IdleView extends St.BoxLayout {
    _init() {
        super._init({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'bn-idle',
            x_expand: true,
            y_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._time = new St.Label({style_class: 'bn-idle-time', x_align: Clutter.ActorAlign.CENTER});
        this._date = new St.Label({style_class: 'bn-idle-date', x_align: Clutter.ActorAlign.CENTER});
        const hint = new St.Label({
            style_class: 'bn-idle-hint',
            text: 'Play something to see it here',
            x_align: Clutter.ActorAlign.CENTER,
        });
        this._next = new St.Label({style_class: 'bn-idle-next', x_align: Clutter.ActorAlign.CENTER, visible: false});
        this._next.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        this.add_child(this._time);
        this.add_child(this._date);
        this.add_child(this._next);
        this.add_child(hint);
        this.tick();
    }

    // `next` is the event to name under the date, or null for none.
    tick(next = null) {
        const now = GLib.DateTime.new_now_local();
        this._time.text = now.format('%H:%M');
        this._date.text = now.format('%A, %e %B').replace(/\s+/g, ' ');
        this._next.visible = next !== null;
        if (next) {
            const start = GLib.DateTime.new_from_unix_local(next.date.getTime() / 1000);
            this._next.text = `Up next  ${start.format('%H:%M')}  ${next.summary}`;
        }
    }
});
