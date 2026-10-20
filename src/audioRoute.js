import Gvc from 'gi://Gvc';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

/**
 * Says "Headphones", "Speakers" and the like when the active sound output
 * changes, as the sound settings' port menu already knows it. The first
 * update seen, and any update that repeats the output that was already
 * active — when the extension enables, or the session resumes from suspend
 * — is the snapshot, not a change, and updates while the mixer is still
 * connecting are ignored outright.
 *
 * Emits 'changed' with {name, iconName}.
 */
export class AudioRouteMonitor extends EventEmitter {
    constructor() {
        super();

        const control = getMixerControl();
        this._device = null;
        this._ready = control?.get_state() === Gvc.MixerControlState.READY;
        control?.connectObject(
            'active-output-update', (_c, id) => this._onActiveOutput(control, id),
            'state-changed', () => this._onStateChanged(control),
            this);
    }

    _onStateChanged(control) {
        this._ready = control.get_state() === Gvc.MixerControlState.READY;
        // Whatever was active before a suspend is not worth a peek on
        // getting back; the next update is the snapshot again.
        if (!this._ready)
            this._device = null;
    }

    _onActiveOutput(control, id) {
        const device = control.lookup_output_id(id);
        if (!device)
            return;
        const changed = this._device !== null && this._device !== device.description;
        this._device = device.description;
        if (this._ready && changed)
            this.emit('changed', {name: device.description, iconName: device.icon_name});
    }

    destroy() {
        getMixerControl()?.disconnectObject(this);
        this.disconnectAll();
    }
}
