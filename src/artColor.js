import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

// The shell's idiom for async functions with callbacks: give them a
// promise interface once, then await.
Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async',
    'new_from_stream_finish');

// Covers are averaged into this box: small enough to decode in a moment,
// big enough to average down to the one colour of the picture.
const DECODE_SIZE = 16;
// Averaged covers are often too dark to be seen against the notch, so a
// colour is lifted until its brightest channel is this share of full
// white.
const MIN_VALUE = 0.6;
// Averaged colours are remembered by uri, so flipping back and forth
// between two tracks does not decode twice. At most this many stay, the
// oldest drop out first.
const CACHE_LIMIT = 50;

/**
 * Averages the colour of album art, one uri at a time, without ever
 * reading synchronously on the main thread.
 */
export class ArtColorLoader {
    constructor() {
        this._cache = new Map();
        this._pending = new Set();
    }

    // Promise of [r, g, b], each 0 to 255: the visible colour of the image
    // at the uri. Cancelled or failed decodes stop coming back.
    averageColor(uri, cancellable = null) {
        if (!uri)
            return Promise.resolve(null);
        let promise = this._cache.get(uri);
        if (promise) {
            // Put it back at the end, so the oldest entry is the one that
            // is really oldest.
            this._cache.delete(uri);
            this._cache.set(uri, promise);
            return promise;
        }

        cancellable ??= new Gio.Cancellable();
        this._pending.add(cancellable);
        promise = this._decode(uri, cancellable).finally(() =>
            this._pending.delete(cancellable));
        promise.catch(() => {
            // A cancelled or failed decode must not stay in the cache: a
            // promise that stays rejected would poison the uri forever.
            if (this._cache.get(uri) === promise)
                this._cache.delete(uri);
        });
        this._cache.set(uri, promise);
        if (this._cache.size > CACHE_LIMIT)
            this._cache.delete(this._cache.keys().next().value);
        return promise;
    }

    // Stops decodes this loader started itself; the island calls it when
    // the track changes, so a slow cover does not keep decoding.
    cancel() {
        for (const cancellable of [...this._pending])
            cancellable.cancel();
    }

    destroy() {
        this.cancel();
        this._cache.clear();
    }

    async _decode(uri, cancellable) {
        const file = Gio.File.new_for_uri(uri);
        const stream = await file.read_async(GLib.PRIORITY_DEFAULT, cancellable);
        let pixbuf;
        try {
            pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
                stream, DECODE_SIZE, DECODE_SIZE, true, cancellable);
        } finally {
            // The stream goes back the awaited way it came; a decode that
            // was cancelled leaves it closed anyway.
            await stream.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => {});
        }
        return this._average(pixbuf);
    }

    _average(pixbuf) {
        const width = pixbuf.get_width();
        const height = pixbuf.get_height();
        const channels = pixbuf.get_n_channels();
        const rowstride = pixbuf.get_rowstride();
        const pixels = pixbuf.get_pixels();
        let r = 0, g = 0, b = 0, count = 0;
        for (let y = 0; y < height; y++) {
            const row = y * rowstride;
            for (let x = 0; x < width; x++) {
                const p = row + x * channels;
                // Boxes drawn around a square cover are transparent; they
                // are not part of the colour.
                if (channels === 4 && pixels[p + 3] === 0)
                    continue;
                r += pixels[p];
                g += pixels[p + 1];
                b += pixels[p + 2];
                count++;
            }
        }
        if (count === 0)
            return [255, 255, 255];
        return ArtColorLoader._lift([r / count, g / count, b / count]);
    }

    // Scales one colour up until its brightest channel reaches MIN_VALUE.
    // Every channel scales equally, so the hue and the saturation with
    // them, and only the brightness changes.
    static _lift([r, g, b]) {
        const value = Math.max(r, g, b);
        if (value >= MIN_VALUE * 255)
            return [Math.round(r), Math.round(g), Math.round(b)];
        const lift = value > 0 ? MIN_VALUE * 255 / value : 255;
        return [Math.round(Math.min(255, r * lift)),
            Math.round(Math.min(255, g * lift)),
            Math.round(Math.min(255, b * lift))];
    }
}
