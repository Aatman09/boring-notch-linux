import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {EventEmitter} from 'resource:///org/gnome/shell/misc/signals.js';

// MPRIS takes the place of boring.notch's per-app controllers
// (MediaControllers/*.swift): every Linux player that supports it, including
// Spotify, Firefox, Chromium and most native players, shows up here.

const MPRIS_PREFIX = 'org.mpris.MediaPlayer2';
const MPRIS_PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';
const NO_TRACK = '/org/mpris/MediaPlayer2/TrackList/NoTrack';

const MprisIface = `
<node>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <method name="Raise"/>
  </interface>
</node>`;

const PlayerIface = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
      <arg direction="in" type="x" name="Offset"/>
    </method>
    <method name="SetPosition">
      <arg direction="in" type="o" name="TrackId"/>
      <arg direction="in" type="x" name="Position"/>
    </method>
    <signal name="Seeked">
      <arg type="x" name="Position"/>
    </signal>
    <property name="PlaybackStatus" type="s" access="read"/>
    <property name="LoopStatus" type="s" access="readwrite"/>
    <property name="Shuffle" type="b" access="readwrite"/>
    <property name="Rate" type="d" access="read"/>
    <property name="Metadata" type="a{sv}" access="read"/>
    <property name="CanGoNext" type="b" access="read"/>
    <property name="CanGoPrevious" type="b" access="read"/>
    <property name="CanSeek" type="b" access="read"/>
  </interface>
</node>`;

const MprisProxy = Gio.DBusProxy.makeProxyWrapper(MprisIface);
const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(PlayerIface);

const logDBusError = e => console.warn(`Boring Notch: ${e.message}`);

const LOOP_CYCLE = {None: 'Playlist', Playlist: 'Track', Track: 'None'};

class MprisPlayer extends EventEmitter {
    constructor(busName) {
        super();
        this.busName = busName;
        this._cancellable = new Gio.Cancellable();
        this._position = 0;
        this._positionStamp = GLib.get_monotonic_time();
        this._metadata = {};
        this._init();
    }

    async _init() {
        try {
            [this._mpris, this._player] = await Promise.all([
                MprisProxy.newAsync(Gio.DBus.session, this.busName, MPRIS_PATH, this._cancellable),
                PlayerProxy.newAsync(Gio.DBus.session, this.busName, MPRIS_PATH, this._cancellable),
            ]);
        } catch (e) {
            if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                console.warn(`Boring Notch: cannot connect to ${this.busName}: ${e.message}`);
            return;
        }

        this._player.connectObject('g-properties-changed', (_p, changed) => {
            const props = changed.deepUnpack();
            if ('Metadata' in props || 'PlaybackStatus' in props) {
                this._syncPosition();
                this._refreshPosition();
            }
            this._update();
        }, this);
        this._seekedId = this._player.connectSignal('Seeked', (_p, _sender, [position]) => {
            this._setPosition(position);
            this.emit('changed');
        });

        this._update();
        this._refreshPosition();
    }

    _update() {
        const metadata = {};
        for (const [key, value] of Object.entries(this._player.Metadata ?? {}))
            metadata[key] = value.deepUnpack();
        this._metadata = metadata;
        this.emit('changed');
    }

    get ready() {
        return !!this._player;
    }

    get identity() {
        return this._mpris?.Identity ?? '';
    }

    get status() {
        return this._player?.PlaybackStatus ?? 'Stopped';
    }

    get playing() {
        return this.status === 'Playing';
    }

    get title() {
        const title = this._metadata['xesam:title'];
        return typeof title === 'string' ? title : '';
    }

    get artists() {
        const artists = this._metadata['xesam:artist'];
        if (Array.isArray(artists))
            return artists.filter(a => typeof a === 'string').join(', ');
        return typeof artists === 'string' ? artists : '';
    }

    get artUrl() {
        const url = this._metadata['mpris:artUrl'];
        return typeof url === 'string' ? url : '';
    }

    get hasTrack() {
        return this.ready && this.title !== '';
    }

    get trackId() {
        const id = this._metadata['mpris:trackid'];
        return typeof id === 'string' ? id : NO_TRACK;
    }

    // Track length and position are in microseconds, as MPRIS sends them.
    get length() {
        return Number(this._metadata['mpris:length'] ?? 0);
    }

    get position() {
        let position = this._position;
        if (this.playing) {
            const rate = this._player.Rate ?? 1;
            position += (GLib.get_monotonic_time() - this._positionStamp) * rate;
        }
        return this.length > 0 ? Math.min(position, this.length) : position;
    }

    get canSeek() {
        return !!this._player?.CanSeek && this.length > 0 && this.trackId !== NO_TRACK;
    }

    get canGoNext() {
        return !!this._player?.CanGoNext;
    }

    get canGoPrevious() {
        return !!this._player?.CanGoPrevious;
    }

    get shuffle() {
        return !!this._player?.Shuffle;
    }

    get loopStatus() {
        return this._player?.LoopStatus ?? 'None';
    }

    // Freeze the extrapolated position before the playback status changes,
    // so pausing does not lose the time played since the last update.
    _syncPosition() {
        this._position = this.position;
        this._positionStamp = GLib.get_monotonic_time();
    }

    _setPosition(position) {
        this._position = Number(position);
        this._positionStamp = GLib.get_monotonic_time();
    }

    // Players do not announce Position changes, so it has to be asked for.
    _refreshPosition() {
        Gio.DBus.session.call(
            this.busName, MPRIS_PATH,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER_IFACE, 'Position']),
            new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (conn, res) => {
                try {
                    const [position] = conn.call_finish(res).deepUnpack();
                    this._setPosition(position.deepUnpack());
                    this.emit('changed');
                } catch {
                    // Some players do not implement Position; keep estimating.
                }
            });
    }

    playPause() {
        this._player?.PlayPauseAsync().catch(logDBusError);
    }

    next() {
        this._player?.NextAsync().catch(logDBusError);
    }

    previous() {
        this._player?.PreviousAsync().catch(logDBusError);
    }

    seek(fraction) {
        if (!this.canSeek)
            return;
        const position = Math.round(fraction * this.length);
        this._setPosition(position);
        this._player.SetPositionAsync(this.trackId, position).catch(logDBusError);
    }

    // Moves by `seconds`, backwards when negative.
    skip(seconds) {
        if (!this.canSeek)
            return;
        const offset = Math.round(seconds * GLib.USEC_PER_SEC);
        this._setPosition(Math.max(0, Math.min(this.length, this.position + offset)));
        this._player.SeekAsync(offset).catch(logDBusError);
    }

    toggleShuffle() {
        if (this._player)
            this._player.Shuffle = !this.shuffle;
    }

    cycleLoop() {
        if (this._player)
            this._player.LoopStatus = LOOP_CYCLE[this.loopStatus] ?? 'None';
    }

    raise() {
        this._mpris?.RaiseAsync().catch(logDBusError);
    }

    destroy() {
        this._cancellable.cancel();
        if (this._player) {
            this._player.disconnectObject(this);
            this._player.disconnectSignal(this._seekedId);
        }
        this._player = null;
        this._mpris = null;
        this.disconnectAll();
    }
}

// Players already playing when the extension starts should not peek.
const SETTLE_MS = 2000;

/**
 * Tracks every MPRIS player on the session bus and picks the one the notch
 * should show: the player that is playing, or else the one that played last.
 * Emits 'changed' whenever that player or its state changes, and
 * 'track-changed' when a new track starts playing or playback resumes.
 */
export class MediaManager extends EventEmitter {
    constructor() {
        super();
        this._players = new Map();
        this._lastActive = null;
        this._playingKey = null;
        this._startTime = GLib.get_monotonic_time();

        this._nameWatchId = Gio.DBus.session.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', MPRIS_PREFIX,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [name, oldOwner, newOwner] = params.deepUnpack();
                if (oldOwner)
                    this._removePlayer(name);
                if (newOwner)
                    this._addPlayer(name);
            });

        this._listPlayers();
    }

    _listPlayers() {
        Gio.DBus.session.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus',
            'org.freedesktop.DBus', 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    const [names] = conn.call_finish(res).deepUnpack();
                    names.filter(n => n.startsWith(`${MPRIS_PREFIX}.`))
                        .forEach(n => this._addPlayer(n));
                } catch (e) {
                    console.warn(`Boring Notch: cannot list media players: ${e.message}`);
                }
            });
    }

    _addPlayer(busName) {
        if (!this._players || this._players.has(busName))
            return;
        const player = new MprisPlayer(busName);
        player.connect('changed', () => {
            if (player.playing)
                this._lastActive = player;
            this.emit('changed');
            this._checkTrack();
        });
        this._players.set(busName, player);
    }

    _removePlayer(busName) {
        const player = this._players?.get(busName);
        if (!player)
            return;
        this._players.delete(busName);
        if (this._lastActive === player)
            this._lastActive = null;
        player.destroy();
        this.emit('changed');
    }

    _checkTrack() {
        const player = this.activePlayer;
        const key = player?.playing ? `${player.busName}\n${player.title}\n${player.artists}` : null;
        if (key === this._playingKey)
            return;
        this._playingKey = key;
        const settled = GLib.get_monotonic_time() - this._startTime > SETTLE_MS * 1000;
        if (key && settled)
            this.emit('track-changed', player);
    }

    get activePlayer() {
        const players = [...this._players.values()].filter(p => p.hasTrack);
        if (this._lastActive?.playing && this._lastActive.hasTrack)
            return this._lastActive;
        return players.find(p => p.playing) ??
            (this._lastActive?.hasTrack ? this._lastActive : null) ??
            players[0] ?? null;
    }

    destroy() {
        Gio.DBus.session.signal_unsubscribe(this._nameWatchId);
        this._players.forEach(p => p.destroy());
        this._players = null;
        this._lastActive = null;
        this.disconnectAll();
    }
}
