// Demo helpers installed into the headless shell by demo.sh: a pointer that
// glides, clicks, and the fake content the scenes use. Kept on global.demo.
const Clutter = imports.gi.Clutter;
const seat = global.stage.context.get_backend().get_default_seat();
const island = Main.layoutManager.uiGroup.get_children().find(a => a.name === 'boring-notch');
global.bn = island;
global.demo = {
    pointer: seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE),
    at: [960, 700],

    // Glides the pointer to x, y over `ms`, eased in and out.
    move(x, y, ms = 600) {
        const [x0, y0] = this.at;
        const start = GLib.get_monotonic_time();
        this.at = [x, y];
        GLib.timeout_add(GLib.PRIORITY_HIGH, 8, () => {
            const k = Math.min(1, (GLib.get_monotonic_time() - start) / (ms * 1000));
            const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
            this.pointer.notify_absolute_motion(GLib.get_monotonic_time(), x0 + (x - x0) * e, y0 + (y - y0) * e);
            return k < 1;
        });
    },

    press() {
        this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
    },

    release() {
        this.pointer.notify_button(GLib.get_monotonic_time(), Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
    },

    click() {
        this.press();
        GLib.timeout_add(GLib.PRIORITY_HIGH, 60, () => {
            this.release();
            return false;
        });
    },

    // Moves to the open notch's header tab `id` and clicks it.
    tab(id, ms = 500) {
        const button = island._openView._header._tabs.get(id);
        const [x, y] = button.get_transformed_position();
        const [w, h] = button.get_transformed_size();
        this.move(x + w / 2, y + h / 2, ms);
        GLib.timeout_add(GLib.PRIORITY_HIGH, ms + 80, () => {
            this.click();
            return false;
        });
    },

    // Calendar events relative to now, in minutes: [[start, length, title], ...].
    events(list) {
        const source = island._openView.eventSource;
        const now = Date.now();
        source._events.clear();
        list.forEach(([start, length, title], i) => {
            const id = `demo${String.fromCharCode(10)}${i}`;
            source._events.set(id, {id, date: new Date(now + start * 60000), end: new Date(now + (start + length) * 60000), summary: title});
        });
        source.emit('changed');
    },

    // A weather answer without the network.
    weather(json) {
        const weather = island._sources.weather;
        weather._fetch = () => Promise.resolve(JSON.stringify(json));
    },

    // Volume changes from `from` to `to` in steps, like a few wheel notches.
    volume(from, to, steps = 6, ms = 110) {
        for (let i = 0; i <= steps; i++) {
            GLib.timeout_add(GLib.PRIORITY_HIGH, i * ms, () => {
                const level = from + (to - from) * i / steps;
                const name = level > 2 / 3 ? 'high' : level > 1 / 3 ? 'medium' : 'low';
                island.showHud(new Gio.ThemedIcon({name: `audio-volume-${name}-symbolic`}), null, level, 1);
                return false;
            });
        }
    },

    // The synced lyrics of the fake track, without the network: LRC lines.
    lyrics(lines) {
        const lrc = lines.join(String.fromCharCode(10));
        island._sources.lyrics._fetch = () => Promise.resolve(lrc);
    },

    clear() {
        Main.messageTray.getSources().forEach(s => s.destroy());
        island._clearPeeks();
        island._sources.shelf.clear();
    },
};
'staged';
