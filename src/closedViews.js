import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';

import {AlbumArt, MarqueeLabel, Visualizer} from './widgets.js';

// What the closed notch shows when it is wider than the bare notch: content
// on the left and right of the middle, which stays empty like the hardware
// notch on a MacBook. Each view says how much width it adds on each side.

export const ClosedView = GObject.registerClass(
class ClosedView extends St.BoxLayout {
    _init(styleClass) {
        super._init({
            style_class: `bn-closed-view ${styleClass}`,
            x_expand: true,
            y_expand: true,
            opacity: 0,
            visible: false,
        });
        this.left = new St.BoxLayout({
            style_class: 'bn-closed-left',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.right = new St.BoxLayout({
            style_class: 'bn-closed-right',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.add_child(this.left);
        this.add_child(new St.Widget({x_expand: true}));
        this.add_child(this.right);
    }

    // Extra width on each side of the bare notch, in design pixels.
    sideWidth(_notchHeight) {
        return 0;
    }

    // Extra height under the panel height, for peeks taller than the top
    // bar, in design pixels.
    extraHeight() {
        return 0;
    }

    // Called by the island once a fade-out of this view has finished, so a
    // view can let things go that must stay visible while fading. The
    // default has nothing to let go of.
    onHidden() {
    }

    // Live activities leave the middle free for the clock. Peeks use the
    // whole notch, so the clock steps aside for them.
    get showsClock() {
        return true;
    }

    // Whether a press belongs to a control inside the view (a bar, a
    // button), so the island leaves it to that control instead of acting
    // on the whole peek.
    takesPress(_event) {
        return false;
    }

    // Turns the left and right halves into one group in the middle: the
    // base layout puts its halves at the notch's edges, which leaves a gap
    // between things that belong together. Both halves then name the
    // group, so subclasses can add to either. Returns the group.
    _centre() {
        const [left, gap, right] = this.get_children();
        this.remove_child(gap);
        this.remove_child(right);
        this.right = left;
        left.x_expand = true;
        left.x_align = Clutter.ActorAlign.CENTER;
        return left;
    }
});

/** MusicLiveActivity: album art on the left, visualizer on the right. */
export const LiveMediaView = GObject.registerClass(
class LiveMediaView extends ClosedView {
    _init(audio) {
        super._init('bn-live-media');
        this._art = new AlbumArt('bn-art-small');
        this.left.add_child(this._art);
        this._visualizer = new Visualizer(audio);
        this.right.add_child(this._visualizer);
    }

    sideWidth(notchHeight) {
        return notchHeight + 2;
    }

    update(artUri) {
        this._art.set_art(artUri);
    }

    setAnimating(animating, followAudio) {
        this._visualizer.set_playing(animating, followAudio);
    }

    setColor(rgb) {
        this._visualizer.setColor(rgb);
    }
});

// Which level the HUD bar can set, from the icon the OSD gave it. The
// keyboard backlight, the microphone and anything else stay read-only.
function hudKind(icon) {
    const name = icon instanceof Gio.ThemedIcon ? icon.names[0] : null;
    if (name?.startsWith('audio-volume'))
        return 'volume';
    if (name?.startsWith('display-brightness'))
        return 'brightness';
    return null;
}

/** HudView: the volume or brightness icon, a level bar and the percentage.
 *  The inline style shares the top-bar row with the clock; the row style
 *  grows the notch a row under it. The bar is a slider where the island
 *  knows how to set the level, and read-only everywhere else. */
const HudView = GObject.registerClass(
class HudView extends ClosedView {
    _init(settings, styleClass) {
        super._init(styleClass);
        this._settings = settings;
        this._icon = new St.Icon({style_class: `${styleClass}-icon`});
        this.left.add_child(this._icon);

        // A Slider is a BarLevel: the same look, plus dragging. Its own
        // theme class would add a handle; the HUD bar is just a bar.
        this._bar = new Slider.Slider(0);
        this._bar.remove_style_class_name('slider');
        this._bar.add_style_class_name(`${styleClass}-bar`);
        this._bar.y_align = Clutter.ActorAlign.CENTER;
        this._bar.x_expand = false;
        this._bar.can_focus = false;
        this._bar.connect('drag-begin', () => (this._dragging = true));
        this._bar.connect('drag-end', () => (this._dragging = false));
        this._bar.connect('notify::value', () => this._onBarValue());
        this._value = new St.Label({
            style_class: `${styleClass}-value`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: `${styleClass}-label`,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.right.add_child(this._bar);
        this.right.add_child(this._value);
        this.right.add_child(this._label);

        // Set by the island: (kind, level, maxLevel) => level, or null when
        // there is nothing here that can set it.
        this.onAdjust = null;
        this._kind = null;
        this._level = 0;
        this._maxLevel = 1;
        this._dragging = false;
        this._updating = false;
    }

    // Takes the arguments of OsdWindowManager._showOsdWindow; level runs
    // from 0 to maxLevel, where 1 is 100%.
    update(icon, label, level, maxLevel) {
        this._icon.gicon = icon;
        this._kind = hudKind(icon);
        this._bar.reactive = this._kind !== null;
        const hasLevel = typeof level === 'number';
        this._bar.visible = hasLevel;
        this._label.visible = !hasLevel;
        this._value.visible = hasLevel &&
            this._settings.get_boolean('hud-percentage');
        if (hasLevel) {
            const max = maxLevel > 0 ? maxLevel : 1;
            this._maxLevel = max;
            this._level = Math.max(0, Math.min(level, max));
            // A drag is the authority while it goes on.
            if (!this._dragging) {
                this._updating = true;
                this._bar.maximum_value = max;
                this._bar.overdrive_start = 1;
                this._bar.value = this._level;
                this._updating = false;
                this._value.text = `${Math.round(this._level * 100)}`;
            }
        } else {
            this._label.text = label ?? '';
        }
    }

    // Dragging the bar (or scrolling it) sets the level; the island does
    // the setting and tells the view what it came to.
    _onBarValue() {
        if (this._updating)
            return;
        const level = this.onAdjust?.(this._kind, this._bar.value, this._maxLevel);
        if (typeof level !== 'number')
            return;
        this._level = level;
        this._value.text = `${Math.round(level * 100)}`;
    }

    // A press on the bar is the slider's.
    takesPress(event) {
        return event.get_source() === this._bar;
    }

    // A bar the pointer is on or dragging must not vanish under the hand.
    isInUse() {
        return this._dragging || this._bar.hover;
    }
});

/** Inline style: the bar beside the icon, in the top-bar row. */
export const InlineHudView = GObject.registerClass(
class InlineHudView extends HudView {
    _init(settings) {
        super._init(settings, 'bn-hud');
    }

    sideWidth() {
        return 100;
    }

    get showsClock() {
        return false;
    }
});

/** Row style: the notch grows a row under the clock, icon one end, a long
 *  bar and the percentage at the other. */
export const RowHudView = GObject.registerClass(
class RowHudView extends HudView {
    _init(settings) {
        super._init(settings, 'bn-row-hud');
        // The row's content hugs the bottom, leaving the top-bar height
        // free for the clock.
        this.left.y_align = Clutter.ActorAlign.END;
        this.right.y_align = Clutter.ActorAlign.END;
    }

    sideWidth() {
        return 155;
    }

    // One row of content, below the top bar the clock stays in.
    extraHeight() {
        return 28;
    }
});

/** The battery peek shown when a charger is plugged in or removed. */
export const BatterySneakView = GObject.registerClass(
class BatterySneakView extends ClosedView {
    _init() {
        super._init('bn-battery-sneak');
        this._status = new St.Label({
            style_class: 'bn-battery-status',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.left.add_child(this._status);

        this._percent = new St.Label({
            style_class: 'bn-battery-percent',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._icon = new St.Icon({style_class: 'bn-battery-icon'});
        this.right.add_child(this._percent);
        this.right.add_child(this._icon);
    }

    sideWidth() {
        return 80;
    }

    get showsClock() {
        return false;
    }

    // levelMark is 'full', 'critical', 'low' or 'saver' for the power
    // profile peek; without one the text says what the battery is doing.
    update(battery, levelMark = null) {
        if (levelMark === 'saver')
            this._status.text = battery.powerSaver ? 'Power saver on' : 'Power saver off';
        else if (levelMark === 'full')
            this._status.text = 'Fully charged';
        else if (levelMark === 'critical')
            this._status.text = 'Critical battery';
        else if (levelMark)
            this._status.text = 'Low battery';
        else
            this._status.text = battery.statusText;
        this._percent.text = `${battery.percentage}%`;
        this._icon.icon_name = battery.iconName;
        this._status.remove_style_class_name('bn-charging');
        this._status.remove_style_class_name('bn-low');
        this._status.remove_style_class_name('bn-full');
        if (levelMark === 'full')
            this._status.add_style_class_name('bn-full');
        else if (levelMark && levelMark !== 'saver')
            this._status.add_style_class_name('bn-low');
        else if (!levelMark && battery.pluggedIn)
            this._status.add_style_class_name('bn-charging');
    }
});

/** The thumbnail of a screenshot that was just taken, shown as a peek. */
export const ScreenshotPeekView = GObject.registerClass(
class ScreenshotPeekView extends ClosedView {
    _init() {
        super._init('bn-screenshot-peek');
        // The thumbnail and its caption, centred together. GNOME hands the
        // screenshot over as an St.ImageContent, which always shows whole,
        // whatever its size.
        this._thumbnail = new St.Widget({
            style_class: 'bn-screenshot-thumbnail',
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
        });
        this._caption = new St.Label({
            style_class: 'bn-screenshot-caption',
            text: 'Screenshot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        const group = this._centre();
        group.add_child(this._thumbnail);
        group.add_child(this._caption);
    }

    sideWidth() {
        // The thumbnail, the caption and the padding, with room to spare
        // for the caption at the largest text size.
        return 64;
    }

    // Room for the thumbnail under the panel height.
    extraHeight() {
        return 90;
    }

    get showsClock() {
        return false;
    }

    update(gicon) {
        this._thumbnail.content = gicon;
    }

    // The content keeps the texture; dropping it during the fade-out would
    // make the picture vanish while the notch is still showing it.
    onHidden() {
        this._thumbnail.content = null;
    }
});

/**
 * An icon and some text. Live activities (timer, downloads) put the text on
 * the right, around the clock. Peeks (notifications, finished downloads) are
 * one left-aligned row with no clock, or with `centred` one row in the
 * middle.
 */
export const IconTextView = GObject.registerClass(
class IconTextView extends ClosedView {
    _init(styleClass, sideWidth, {peek = false, centred = false} = {}) {
        super._init(`bn-icon-text ${styleClass}`);
        this._side = sideWidth;
        this._peek = peek;
        if (centred)
            this._centre();
        this._icon = new St.Icon({style_class: 'bn-icon-text-icon', y_align: Clutter.ActorAlign.CENTER});
        this.left.add_child(this._icon);
        this._title = new St.Label({style_class: 'bn-icon-text-title', y_align: Clutter.ActorAlign.CENTER});
        this._body = new St.Label({style_class: 'bn-icon-text-body', y_align: Clutter.ActorAlign.CENTER});
        if (peek)
            this.left.x_expand = true;
        const textBox = peek ? this.left : this.right;
        textBox.add_child(this._title);
        textBox.add_child(this._body);
    }

    sideWidth() {
        return this._side;
    }

    get showsClock() {
        return !this._peek;
    }

    update({icon = null, iconName = null, title = '', body = ''}) {
        if (icon)
            this._icon.gicon = icon;
        else
            this._icon.icon_name = iconName;
        this._title.text = title;
        this._title.visible = title !== '';
        this._body.text = body;
        this._body.visible = body !== '';
    }
});

/** A notification peek: the text on the left, and up to two of the
 *  notification's own buttons on the right. The buttons go once the peek
 *  has faded out, so a button cannot act for a notification that is gone. */
export const NotificationPeekView = GObject.registerClass(
class NotificationPeekView extends IconTextView {
    _init() {
        super._init('bn-message-sneak', 150, {peek: true});
        this._buttons = new St.BoxLayout({style_class: 'bn-notification-buttons', y_align: Clutter.ActorAlign.CENTER});
        this.right.add_child(this._buttons);
    }

    // `actions` holds {label, activate} for each button, at most two.
    update({actions = [], ...text}) {
        super.update(text);
        this._buttons.destroy_all_children();
        for (const {label, activate} of actions) {
            const button = new St.Button({style_class: 'bn-chip', label, can_focus: true});
            button.connect('clicked', activate);
            this._buttons.add_child(button);
        }
    }

    // A press on a button is the button's. The press's own source can be
    // missing, so the buttons' hover is asked instead.
    takesPress(_event) {
        return this._buttons.get_children().some(button => button.hover);
    }

    onHidden() {
        this._buttons.destroy_all_children();
    }
});

/** What just started playing: the cover, then title and artist in one row. */
export const MusicPeekView = GObject.registerClass(
class MusicPeekView extends ClosedView {
    _init() {
        super._init('bn-music-peek');
        this.left.x_expand = true;
        this._art = new AlbumArt('bn-art-small');
        // The caps keep the marquees narrower than their labels, so a long
        // title has somewhere to slide.
        this._title = new MarqueeLabel('bn-icon-text-title', 'bn-peek-title');
        this._artist = new MarqueeLabel('bn-icon-text-body', 'bn-peek-artist');
        this.left.add_child(this._art);
        this.left.add_child(this._title);
        this.left.add_child(this._artist);
    }

    sideWidth() {
        return 150;
    }

    get showsClock() {
        return false;
    }

    // Long titles slide while the peek shows; the island turns this on
    // and off with the peek.
    setScrolling(active) {
        for (const label of [this._title, this._artist])
            label.setScrolling(active);
    }

    // The player can be gone by the time its cover resolves: a browser
    // closing after a track change leaves nothing to name.
    update(player, artUri) {
        this._art.set_art(artUri);
        this._title.set(player ? player.title : '');
        this._artist.set(player ? (player.artists || player.identity) : '');
    }
});
