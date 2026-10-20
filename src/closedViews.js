import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as BarLevel from 'resource:///org/gnome/shell/ui/barLevel.js';

import {AlbumArt, Visualizer} from './widgets.js';

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

    // Live activities leave the middle free for the clock. Peeks use the
    // whole notch, so the clock steps aside for them.
    get showsClock() {
        return true;
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
});

/** InlineHUD: the volume or brightness icon, then the level bar. */
export const InlineHudView = GObject.registerClass(
class InlineHudView extends ClosedView {
    _init() {
        super._init('bn-hud');
        this._icon = new St.Icon({style_class: 'bn-hud-icon'});
        this.left.add_child(this._icon);

        this._bar = new BarLevel.BarLevel({
            style_class: 'bn-hud-bar',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._value = new St.Label({
            style_class: 'bn-hud-value',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._label = new St.Label({
            style_class: 'bn-hud-label',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.right.add_child(this._bar);
        this.right.add_child(this._value);
        this.right.add_child(this._label);
    }

    sideWidth() {
        return 100;
    }

    get showsClock() {
        return false;
    }

    // Takes the arguments of OsdWindowManager._showOsdWindow; level runs
    // from 0 to maxLevel, where 1 is 100%.
    update(icon, label, level, maxLevel) {
        this._icon.gicon = icon;
        const hasLevel = typeof level === 'number';
        this._bar.visible = hasLevel;
        this._value.visible = hasLevel;
        this._label.visible = !hasLevel;
        if (hasLevel) {
            const max = maxLevel > 0 ? maxLevel : 1;
            this._bar.maximum_value = max;
            this._bar.overdrive_start = 1;
            this._bar.value = Math.max(0, Math.min(level, max));
            this._value.text = `${Math.round(level * 100)}`;
        } else {
            this._label.text = label ?? '';
        }
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

    update(battery, levelMark = null) {
        if (levelMark === 'full')
            this._status.text = 'Fully charged';
        else if (levelMark === 'critical')
            this._status.text = 'Critical battery';
        else if (levelMark)
            this._status.text = 'Low battery';
        else
            this._status.text = battery.charging ? 'Charging'
                : battery.pluggedIn ? 'Plugged in' : 'On battery';
        this._percent.text = `${battery.percentage}%`;
        this._icon.icon_name = battery.iconName;
        this._status.remove_style_class_name('bn-charging');
        this._status.remove_style_class_name('bn-low');
        this._status.remove_style_class_name('bn-full');
        if (levelMark === 'full')
            this._status.add_style_class_name('bn-full');
        else if (levelMark)
            this._status.add_style_class_name('bn-low');
        else if (battery.pluggedIn)
            this._status.add_style_class_name('bn-charging');
    }
});

/** The thumbnail of a screenshot that was just taken, shown as a peek. */
export const ScreenshotPeekView = GObject.registerClass(
class ScreenshotPeekView extends ClosedView {
    _init() {
        super._init('bn-screenshot-peek');
        // GNOME hands the screenshot over as an St.ImageContent, which
        // always shows whole, whatever its size.
        this._thumbnail = new St.Widget({
            style_class: 'bn-screenshot-thumbnail',
            content_gravity: Clutter.ContentGravity.RESIZE_ASPECT,
        });
        this.left.add_child(this._thumbnail);
        this._caption = new St.Label({
            style_class: 'bn-screenshot-caption',
            text: 'Screenshot',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this.right.add_child(this._caption);
    }

    sideWidth() {
        return 120;
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

    // Dropping the content unloads the texture, so the screenshot does not
    // stay in memory while something else is showing.
    clear() {
        this._thumbnail.content = null;
    }
});

/**
 * An icon and some text. Live activities (timer, downloads) put the text on
 * the right, around the clock. Peeks (notifications, finished downloads) are
 * one left-aligned row with no clock.
 */
export const IconTextView = GObject.registerClass(
class IconTextView extends ClosedView {
    _init(styleClass, sideWidth, {peek = false} = {}) {
        super._init(`bn-icon-text ${styleClass}`);
        this._side = sideWidth;
        this._peek = peek;
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

/** What just started playing: the cover, then title and artist in one row. */
export const MusicPeekView = GObject.registerClass(
class MusicPeekView extends ClosedView {
    _init() {
        super._init('bn-music-peek');
        this.left.x_expand = true;
        this._art = new AlbumArt('bn-art-small');
        this._title = new St.Label({style_class: 'bn-icon-text-title', y_align: Clutter.ActorAlign.CENTER});
        this._artist = new St.Label({style_class: 'bn-icon-text-body', y_align: Clutter.ActorAlign.CENTER});
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

    update(player, artUri) {
        this._art.set_art(artUri);
        this._title.text = player.title;
        this._artist.text = player.artists || player.identity;
    }
});
