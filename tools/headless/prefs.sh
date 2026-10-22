#!/bin/bash
# Opens the extension's preferences for real, under the headless session's
# own display and settings, and screenshots every page. gnome-extensions
# would block the window on page clicks, so prefs.js is stubbed:
# ExtensionPreferences is swapped for a small base class, and the runner
# walks the pages with Adw's visible-page property. Usage: prefs.sh
. "$(dirname "$(readlink -f "$0")")/common.sh"

if [ ! "$(pgrep -c gnome-shell)" ]; then echo "no session (session.sh, wait.sh first)"; exit 1; fi

# The runner needs the session's own display and settings store.
SPID=$(shell_pid)
WAYLAND_DISPLAY=$(tr '\0' '\n' < /proc/$SPID/environ | grep ^WAYLAND_DISPLAY= | cut -d= -f2)
XDG_RUNTIME_DIR=$(runtime_dir)
export WAYLAND_DISPLAY XDG_RUNTIME_DIR GSETTINGS_SCHEMA_DIR=$REPO/schemas
export DBUS_SESSION_BUS_ADDRESS=$(bus) HOME=$T/home XDG_CONFIG_HOME=$T/config \
    XDG_DATA_HOME=$T/data XDG_CACHE_HOME=$T/cache

mkdir -p "$T/prefs" /tmp/prefsshots
rm -f /tmp/prefsshots/*.png
# The only change to prefs.js: where its base class comes from, plus a
# GObject.registerClass for the subclass, which the extension system's
# own loader would otherwise arrange.
sed -e "s|'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js'|'./prefs-base.mjs'|" \
    -e "s|^import Adw from 'gi://Adw';|import GObject from 'gi://GObject';\nimport Adw from 'gi://Adw';|" \
    "$REPO/prefs.js" > "$T/prefs/prefs-stubbed.mjs"
echo "
GObject.registerClass(BoringNotchPreferences);" >> "$T/prefs/prefs-stubbed.mjs"
cp "$REPO/metadata.json" "$T/prefs/"
cat > "$T/prefs/prefs-base.mjs" <<'BASE'
// The slice of ExtensionPreferences the runner needs.
import GObject from 'gi://GObject';
import Gio from 'gi://Gio';

export const ExtensionPreferences = GObject.registerClass(
class ExtensionPreferences extends GObject.Object {
    getSettings() {
        return new Gio.Settings({schema_id: 'org.gnome.shell.extensions.boring-notch-linux'});
    }
});
BASE

cat > "$T/prefs/runner.mjs" <<'RUNNER'
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

const sleep = ms => new Promise(r =>
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => (r(), GLib.SOURCE_REMOVE)));

Gtk.init();
Adw.init();

const {default: Prefs} = await import('./prefs-stubbed.mjs');
const metadata = JSON.parse(new TextDecoder().decode(Gio.File.new_for_path('metadata.json').load_contents(null)[1]));

const snap = name => new Promise((resolve, reject) =>
    Gio.DBus.session.call('org.gnome.Shell.Screenshot', '/org/gnome/Shell/Screenshot',
        'org.gnome.Shell.Screenshot', 'Screenshot',
        new GLib.Variant('(bbs)', [true, false, name]), null,
        Gio.DBusCallFlags.NONE, -1, null, (c, r) => {
            try {
                const [ok] = c.call_finish(r).deepUnpack();
                if (!ok)
                    reject(new Error(`screenshot ${name} refused`));
                resolve();
            } catch (e) {
                reject(e);
            }
        }));

const prefs = new Prefs();
prefs.metadata = metadata;
const window = new Adw.PreferencesWindow();
window.set_default_size(700, 620);
// libadwaita 1.9 has no pages property; collect what fill adds.
const pages = [];
const add = window.add.bind(window);
window.add = page => (pages.push(page), add(page));
window.present();
prefs.fillPreferencesWindow(window);
for (const page of pages) {
    window.set_visible_page(page);
    await sleep(500);
    await snap(`/tmp/prefsshots/${page.title.toLowerCase()}.png`);
}
print(`done: ${pages.map(p => p.title).join(', ')}`);
GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => GLib.MainLoop.default.quit());
RUNNER

cd "$T/prefs"
timeout 30 gjs -m runner.mjs 2>&1 | tee "$T/prefs/prefs.run.log" | grep -v "Missing FAKE icon" || true
grep -cE "Error:|SomeObject|Unrecognized" "$T/prefs/prefs.run.log" | head -1
exit 0
