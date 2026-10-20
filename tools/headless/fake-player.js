// A fake MPRIS music player for the headless session.
// Usage: gjs -m fake-player.js <art.png|none>
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const art = ARGV[0] === 'none' ? null : Gio.File.new_for_path(ARGV[0]).get_uri();
const xml = name => `<node>${{
    root: `<interface name="org.mpris.MediaPlayer2">
        <property name="Identity" type="s" access="read"/>
        <property name="DesktopEntry" type="s" access="read"/>
        <method name="Raise"/></interface>`,
    player: `<interface name="org.mpris.MediaPlayer2.Player">
        <method name="PlayPause"/><method name="Next"/><method name="Previous"/>
        <method name="Seek"><arg direction="in" type="x"/></method>
        <method name="SetPosition"><arg direction="in" type="o"/><arg direction="in" type="x"/></method>
        <signal name="Seeked"><arg type="x"/></signal>
        <property name="PlaybackStatus" type="s" access="read"/>
        <property name="LoopStatus" type="s" access="readwrite"/>
        <property name="Shuffle" type="b" access="readwrite"/>
        <property name="Rate" type="d" access="read"/>
        <property name="Metadata" type="a{sv}" access="read"/>
        <property name="Position" type="x" access="read"/>
        <property name="CanGoNext" type="b" access="read"/>
        <property name="CanGoPrevious" type="b" access="read"/>
        <property name="CanSeek" type="b" access="read"/></interface>`,
}[name]}</node>`;

const tracks = [['Blinding Lights', 'The Weeknd'], ['Midnight City', 'M83'], ['Starboy', 'The Weeknd, Daft Punk']];
const LENGTH = 200e6;
let i = 0, status = 'Playing', pos = 42e6, stamp = Date.now(), shuffle = false, loop = 'None';
const position = () => Math.min(LENGTH, status === 'Playing' ? pos + (Date.now() - stamp) * 1000 : pos);
const meta = () => ({
    'mpris:trackid': new GLib.Variant('o', `/test/track/${i}`),
    'mpris:length': new GLib.Variant('x', LENGTH),
    ...(art ? {'mpris:artUrl': new GLib.Variant('s', art)} : {}),
    'xesam:title': new GLib.Variant('s', tracks[i][0]),
    'xesam:artist': new GLib.Variant('as', [tracks[i][1]]),
});
const setPos = p => {
    pos = Math.max(0, Math.min(LENGTH, p));
    stamp = Date.now();
    player.emit_signal('Seeked', new GLib.Variant('(x)', [pos]));
};
const changed = props => Gio.DBus.session.emit_signal(null, '/org/mpris/MediaPlayer2',
    'org.freedesktop.DBus.Properties', 'PropertiesChanged',
    new GLib.Variant('(sa{sv}as)', ['org.mpris.MediaPlayer2.Player', props, []]));
const newTrack = step => {
    i = (i + step + tracks.length) % tracks.length;
    pos = 0;
    stamp = Date.now();
    changed({Metadata: new GLib.Variant('a{sv}', meta())});
};

const impl = {
    Identity: 'Test Player', DesktopEntry: '', Raise() {},
    get PlaybackStatus() { return status; },
    get Metadata() { return meta(); },
    get Position() { return position(); },
    get Shuffle() { return shuffle; },
    set Shuffle(v) { shuffle = v; changed({Shuffle: new GLib.Variant('b', v)}); },
    get LoopStatus() { return loop; },
    set LoopStatus(v) { loop = v; changed({LoopStatus: new GLib.Variant('s', v)}); },
    Rate: 1, CanGoNext: true, CanGoPrevious: true, CanSeek: true,
    PlayPause() {
        pos = position();
        stamp = Date.now();
        status = status === 'Playing' ? 'Paused' : 'Playing';
        changed({PlaybackStatus: new GLib.Variant('s', status)});
    },
    Next() { newTrack(1); },
    Previous() { newTrack(-1); },
    Seek(offset) { setPos(position() + offset); },
    SetPosition(_id, p) { setPos(p); },
};
const root = Gio.DBusExportedObject.wrapJSObject(xml('root'), impl);
const player = Gio.DBusExportedObject.wrapJSObject(xml('player'), impl);
root.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
player.export(Gio.DBus.session, '/org/mpris/MediaPlayer2');
Gio.bus_own_name(Gio.BusType.SESSION, 'org.mpris.MediaPlayer2.testplayer', 0, null, null, null);
new GLib.MainLoop(null, false).run();
