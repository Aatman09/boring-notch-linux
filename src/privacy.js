import Shell from 'gi://Shell';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import {getMixerControl} from 'resource:///org/gnome/shell/ui/status/volume.js';

import {IGNORED_RECORDING_APPS} from './audio.js';

/**
 * Watches the microphone, the camera and screen sharing, the way GNOME's
 * own indicators do (ui/status/volume.js, camera.js and remoteAccess.js).
 *
 * Emits 'changed' with {mic: appName, camera: boolean, sharing: boolean}
 * whenever any of the three changes, and 'started' with the kind and the
 * app's name when the microphone or camera goes from not in use to in use.
 * Apps already recording when the extension starts produce no 'started',
 * so re-enabling must not pop a peek for activity that never changed.
 */
export class PrivacyMonitor extends EventEmitter {
    constructor() {
        super();

        this._micApps = this._readMicApps();
        this._camera = false;
        this._handles = new Set();

        getMixerControl()?.connectObject(
            'stream-added', () => this._syncMic(),
            'stream-removed', () => this._syncMic(),
            this);

        this._cameraMonitor = new Shell.CameraMonitor();
        this._cameraMonitor.connectObject('notify::cameras-in-use',
            () => this._syncCamera(), this);

        this._controller = global.backend.get_remote_access_controller();
        this._controller?.connectObject('new-handle',
            (_c, handle) => this._onNewHandle(handle), this);
    }

    // Apps recording audio. Each stream reports the app's desktop id, or
    // just its name when there is no id (gst-launch does). The sound
    // settings' level meters and the visualizer's own capture are left
    // out, like the mic indicator leaves them out.
    _readMicApps() {
        const control = getMixerControl();
        return (control?.get_source_outputs() ?? [])
            .map(output => output.get_application_id() ?? output.get_name())
            .filter(id => id && !IGNORED_RECORDING_APPS.includes(id));
    }

    _syncMic() {
        const micApps = this._readMicApps();
        if (this._sameSet(micApps, this._micApps))
            return;
        this._micApps = micApps;
        if (micApps.length > 0)
            this._emitStarted('mic', micApps[0]);
        this.emit('changed', {
            mic: micApps, camera: this._camera, sharing: this.sharing,
        });
    }

    _sameSet(a, b) {
        return a.length === b.length && a.every(id => b.includes(id));
    }

    _syncCamera() {
        const camera = !!this._cameraMonitor?.cameras_in_use;
        if (camera === this._camera)
            return;
        this._camera = camera;
        if (camera)
            this._emitStarted('camera');
        this.emit('changed', {mic: this._micApps, camera, sharing: this.sharing});
    }

    // Handles appear for screencasts and shared sessions alike and live
    // until their 'stopped' signal fires; GNOME's indicators use the same
    // membership set to decide whether the in-use icon shows.
    _onNewHandle(handle) {
        if (this._handles.has(handle))
            return;
        this._handles.add(handle);
        handle.connectObject('stopped', () => {
            this._handles.delete(handle);
            this.emit('changed', {
                mic: this._micApps, camera: this._camera, sharing: this.sharing,
            });
        }, this);
        this.emit('changed', {mic: this._micApps, camera: this._camera, sharing: true});
    }

    get sharing() {
        return this._handles.size > 0;
    }

    get state() {
        return {mic: this._micApps, camera: this._camera, sharing: this.sharing};
    }

    _emitStarted(kind, appName = null) {
        this.emit('started', kind, appName ? this._appNameFor(appName) : null);
    }

    // The stream id is the desktop id of the app, which names the app the
    // way it appears in menus.
    _appNameFor(id) {
        return Shell.AppSystem.get_default().lookup_app(`${id}.desktop`)?.get_name() ?? id;
    }

    destroy() {
        getMixerControl()?.disconnectObject(this);
        this._cameraMonitor?.disconnectObject(this);
        this._controller?.disconnectObject(this);
        for (const handle of this._handles ?? [])
            handle.disconnectObject(this);
        this._handles.clear();
        this.disconnectAll();
    }
}
