import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// GNOME's microphone indicator ignores the stream with this id; see
// extension.js.
export const VISUALIZER_APP_ID = 'boring-notch-visualizer';

// Updates per second. Each update redraws the bars, so this is a trade
// between smoothness and CPU.
const INTERVAL_MS = 50;

// Bass, low mids, high mids and treble, in Hz.
const BANDS = [[40, 150], [150, 600], [600, 2500], [2500, 8000]];
const RATE = 16000;
const SPECTRUM_BANDS = 128;
const BAND_WIDTH = RATE / 2 / SPECTRUM_BANDS;
// Loudness from FLOOR to CEILING dB maps to 0..1.
const FLOOR = -70;
const CEILING = -10;

// Listens to the default output's monitor, never a microphone. PipeWire
// resamples to 16 kHz mono, and 50 ms buffers keep wake-ups down. gst-launch
// prints each spectrum message; stdbuf makes it print them as they come
// rather than in bursts.
const COMMAND = [
    'stdbuf', '-oL', 'gst-launch-1.0', '-m',
    'pulsesrc', 'device=@DEFAULT_MONITOR@', `client-name=${VISUALIZER_APP_ID}`,
    `stream-properties=props,application.id=${VISUALIZER_APP_ID}`,
    'buffer-time=200000', 'latency-time=50000', '!',
    `audio/x-raw,rate=${RATE},channels=1`, '!',
    'audioconvert', '!',
    'spectrum', `bands=${SPECTRUM_BANDS}`, `threshold=${FLOOR}`,
    `interval=${INTERVAL_MS * 1000000}`, 'post-messages=true', 'message-magnitude=true', '!',
    'fakesink', 'sync=false',
];

// A message line ends with: magnitude=(float){ -63.2, -58.9, ... };
function bandLevels(line) {
    const match = line.match(/magnitude=\(float\)\{([^}]*)\}/);
    if (!match)
        return null;
    const magnitudes = match[1].split(',').map(parseFloat);
    return BANDS.map(([low, high]) => {
        const first = Math.floor(low / BAND_WIDTH);
        const last = Math.min(magnitudes.length - 1, Math.ceil(high / BAND_WIDTH));
        let loudest = FLOOR;
        for (let i = first; i <= last; i++)
            loudest = Math.max(loudest, magnitudes[i]);
        return Math.max(0, Math.min(1, (loudest - FLOOR) / (CEILING - FLOOR)));
    });
}

/**
 * Measures what the computer is playing while the visualizer shows.
 * GStreamer runs in its own process, so a problem there can never take
 * GNOME Shell down with it; if the shell goes away, the process dies the
 * next time it writes.
 *
 * Emits 'levels' with four numbers from 0 to 1 (bass to treble), and
 * 'failed' if it cannot run, so the bars can fall back to moving on their
 * own.
 */
export class AudioLevels extends EventEmitter {
    constructor() {
        super();
        this._process = null;
    }

    get running() {
        return this._process !== null;
    }

    start() {
        if (this._process)
            return;

        let process;
        try {
            process = Gio.Subprocess.new(COMMAND,
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`Boring Notch: cannot start the audio visualizer: ${e.message}`);
            this.emit('failed');
            return;
        }
        this._process = process;
        this._cancellable = new Gio.Cancellable();
        const stdout = new Gio.DataInputStream({
            base_stream: process.get_stdout_pipe(),
            close_base_stream: true,
        });
        this._readLine(stdout, this._cancellable);

        // It only exits on its own when something is wrong, such as
        // GStreamer's PulseAudio plugin missing.
        process.wait_async(null, () => {
            if (this._process !== process)
                return;
            this._stop();
            this.emit('failed');
        });
    }

    _readLine(stdout, cancellable) {
        stdout.read_line_async(GLib.PRIORITY_DEFAULT, cancellable, (stream, res) => {
            let line;
            try {
                [line] = stream.read_line_finish_utf8(res);
            } catch {
                return;
            }
            if (line === null)
                return;
            const levels = bandLevels(line);
            if (levels)
                this.emit('levels', levels);
            this._readLine(stdout, cancellable);
        });
    }

    stop() {
        this._stop();
    }

    _stop() {
        if (!this._process)
            return;
        this._cancellable.cancel();
        this._process.force_exit();
        this._process = null;
    }

    destroy() {
        this._stop();
        this.disconnectAll();
    }
}
