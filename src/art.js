import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

/**
 * Turns an MPRIS art URL into a local file URI that St can draw. Players
 * like Spotify send https URLs, so those are downloaded into the cache once.
 */
export class ArtCache {
    constructor() {
        this._dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'boring-notch-linux', 'art']);
        this._session = new Soup.Session({timeout: 10});
        this._cancellable = new Gio.Cancellable();
    }

    // Calls `callback` with a file URI, or with null when there is no art.
    resolve(url, callback) {
        if (!url) {
            callback(null);
            return;
        }

        if (url.startsWith('file://')) {
            callback(url);
            return;
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            callback(null);
            return;
        }

        const name = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, url, -1);
        const file = Gio.File.new_for_path(GLib.build_filenamev([this._dir, name]));
        if (file.query_exists(null)) {
            callback(file.get_uri());
            return;
        }

        GLib.mkdir_with_parents(this._dir, 0o700);
        const message = Soup.Message.new('GET', url);
        if (!message) {
            callback(null);
            return;
        }

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable,
            (session, res) => {
                let bytes;
                try {
                    bytes = session.send_and_read_finish(res);
                } catch {
                    callback(null);
                    return;
                }
                if (message.get_status() !== Soup.Status.OK) {
                    callback(null);
                    return;
                }
                file.replace_contents_bytes_async(bytes, null, false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION, this._cancellable,
                    (f, r) => {
                        try {
                            f.replace_contents_finish(r);
                            callback(f.get_uri());
                        } catch {
                            callback(null);
                        }
                    });
            });
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }
}
