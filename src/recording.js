import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * Follows GNOME's screen recorder the way the activity indicator in the top
 * right does (ui/status/remoteAccess.js): the screenshot UI answers whether
 * a screencast is running, announces changes through its property signal
 * and can stop one.
 *
 * `recording` holds the state; 'changed' is emitted whenever it changes,
 * and stop() asks the recorder to stop.
 */
export class RecordingMonitor extends EventEmitter {
    constructor() {
        super();

        this.recording = Main.screenshotUI.screencast_in_progress;
        Main.screenshotUI.connectObject('notify::screencast-in-progress',
            () => this._onChange(), this);
    }

    _onChange() {
        const recording = Main.screenshotUI.screencast_in_progress;
        if (recording === this.recording)
            return;
        this.recording = recording;
        this.emit('changed');
    }

    stop() {
        // stopScreencast is asynchronous; if stopping fails, the recorder
        // keeps running and its own indicator stays, which says enough.
        Main.screenshotUI.stopScreencast().catch(e =>
            console.warn(`Boring Notch: stopping the screen recording failed: ${e.message}`));
    }

    destroy() {
        Main.screenshotUI.disconnectObject(this);
        this.disconnectAll();
    }
}
