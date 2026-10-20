import Gio from 'gi://Gio';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

/**
 * How much bigger than its design size the notch is drawn: the Size setting
 * times GNOME's text scaling, so the notch grows with the rest of the
 * desktop when Large Text or text scaling is on. Text is further scaled by
 * the Text size setting. Emits 'changed'.
 */
export class Zoom extends EventEmitter {
    constructor(settings) {
        super();
        this._settings = settings;
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        settings.connectObject(
            'changed::size', () => this.emit('changed'),
            'changed::text-size', () => this.emit('changed'),
            this);
        this._interface.connectObject('changed::text-scaling-factor', () => this.emit('changed'), this);
    }

    get value() {
        return this._settings.get_double('size') * this._interface.get_double('text-scaling-factor');
    }

    // The zoom for the notch's own size. Bigger text needs a bigger notch to
    // sit in, but icons and artwork do not grow with it, so only most of the
    // text zoom is used.
    get layoutValue() {
        return this.value * (1 + (this._settings.get_double('text-size') - 1) * 0.8);
    }

    // The zoom for font sizes.
    get textValue() {
        return this.value * this._settings.get_double('text-size');
    }

    destroy() {
        this._settings.disconnectObject(this);
        this._interface.disconnectObject(this);
        this.disconnectAll();
    }
}
