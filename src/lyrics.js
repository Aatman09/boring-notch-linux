import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

const LRCLIB = 'https://lrclib.net/api/get';
const USER_AGENT = 'boring-notch-linux (https://github.com/Aatman09/boring-notch-linux)';
const TIMEOUT_S = 10;
// A track gets this many requests at most when they fail: no more.
const ATTEMPTS = 2;

// A line of LRC: one or more [mm:ss.xx] tags, then the words.
const LINE = /^((?:\[\d+:\d{2}(?:[.:]\d{1,3})?\])+)\s*(.*)$/;
const TAG = /\[(\d+):(\d{2})(?:[.:](\d{1,3}))?\]/g;

/** Parses LRC text into [{time (milliseconds), text}], in time order. */
export function parseLrc(text) {
    const lines = [];
    for (const raw of text.split('\n')) {
        const match = raw.trim().match(LINE);
        if (!match)
            continue;
        const [, tags, words] = match;
        for (const [, minutes, seconds, fraction = '0'] of tags.matchAll(TAG)) {
            const time = (Number(minutes) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'));
            lines.push({time, text: words.trim()});
        }
    }
    return lines.sort((a, b) => a.time - b.time);
}

// The line sung at a position in microseconds: the last one that has started,
// or '' before the first line and for lyrics that have no lines.
function lineAt(lines, positionUs) {
    const ms = positionUs / 1000;
    let low = 0;
    let high = lines.length - 1;
    let found = -1;
    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lines[mid].time <= ms) {
            found = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }
    return found === -1 ? '' : lines[found].text;
}

function readFile(file, cancellable) {
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (f, res) => {
            try {
                const [, contents] = f.load_contents_finish(res);
                resolve(new TextDecoder().decode(contents));
            } catch (e) {
                reject(e);
            }
        });
    });
}

function sendAndRead(session, message, cancellable) {
    return new Promise((resolve, reject) => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (s, res) => {
            try {
                resolve(s.send_and_read_finish(res));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * Synced lyrics for the track that is playing, from lrclib.net. Each track
 * is looked up once; the answer, including "no lyrics", is kept on disk in
 * the cache folder, so a track is only ever asked for once. Failed requests
 * are not kept and are retried once. Nothing is requested unless follow() is
 * given a player, which the Island does only while show-lyrics is on.
 */
export class LyricsService {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'boring-notch-linux', 'lyrics']);
        this._session = new Soup.Session({timeout: TIMEOUT_S, user_agent: USER_AGENT});
        this._key = null;
        this._lines = [];
        this._cancellable = null;
    }

    // Loads the lyrics of the player's track, forgetting the last track's.
    // A null player forgets it all.
    follow(player) {
        const track = player && player.title ? {
            title: player.title,
            artist: player.artists,
            album: player.album,
            duration: Math.round(player.length / 1e6),
        } : null;
        const key = track ? `${track.artist}\n${track.title}\n${track.duration}` : null;
        if (key === this._key)
            return;
        this._cancellable?.cancel();
        this._key = key;
        this._lines = [];
        this._cancellable = track ? new Gio.Cancellable() : null;
        if (track)
            this._load(track, key, this._cancellable);
    }

    // The line to show at a position in microseconds, or ''.
    lineAt(positionUs) {
        return lineAt(this._lines, positionUs);
    }

    async _load(track, key, cancellable) {
        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1);
        const file = Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
        let text = await this._cached(file, cancellable);
        if (text === null) {
            text = await this._fetch(track, cancellable);
            if (text !== null)
                this._store(file, text);
        }
        if (cancellable.is_cancelled() || key !== this._key)
            return;
        this._lines = parseLrc(text ?? '');
    }

    // The LRC text kept on disk for the track, or null when there is none.
    async _cached(file, cancellable) {
        try {
            return JSON.parse(await readFile(file, cancellable)).syncedLyrics ?? null;
        } catch {
            return null;
        }
    }

    // The synced lyrics as LRC text, '' when lrclib has none, or null when
    // the requests failed.
    async _fetch(track, cancellable) {
        const params = {track_name: track.title, artist_name: track.artist, album_name: track.album};
        if (track.duration > 0)
            params.duration = String(track.duration);
        const query = Object.entries(params)
            .filter(([, value]) => value)
            .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
            .join('&');
        for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
            const message = Soup.Message.new('GET', `${LRCLIB}?${query}`);
            try {
                const bytes = await sendAndRead(this._session, message, cancellable);
                const status = message.get_status();
                if (status === Soup.Status.NOT_FOUND)
                    return '';
                if (status === Soup.Status.OK)
                    return JSON.parse(new TextDecoder().decode(bytes.get_data()))?.syncedLyrics ?? '';
            } catch {
                if (cancellable.is_cancelled())
                    return null;
            }
        }
        return null;
    }

    // Kept as JSON so the file is never empty: an empty answer is still an
    // answer, and GLib refuses to write an empty buffer.
    _store(file, text) {
        GLib.mkdir_with_parents(this._dir, 0o700);
        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify({syncedLyrics: text})));
        // A cache that cannot be written only means the next start asks again.
        file.replace_contents_bytes_async(bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION, null, (f, res) => {
                try {
                    f.replace_contents_finish(res);
                } catch {
                    // Nothing to do: see above.
                }
            });
    }

    destroy() {
        this._cancellable?.cancel();
        this._session.abort();
        this._session = null;
    }
}
