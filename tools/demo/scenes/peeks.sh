# Peeks: volume, a message with its buttons, Caps Lock, earbuds connecting
# and Do Not Disturb, over music playing in the closed notch.
AREA="460 0 1000 250"
LENGTH=19

setup() {
    player cover-dusk.png "Paper Planes at Dusk@The Sundial Club"
    js 'global.demo.move(960, 700, 10)'
    pause 3
}

scene() {
    pause 1.5
    js 'global.demo.volume(0.35, 0.75, 7)'
    pause 2.6
    notify Messages mail-unread-symbolic "Maya" "Are you free for a quick call?" '["call", "Call", "later", "Later"]'
    pause 4.4
    js 'global.bn._sources.keyboard.emit("caps-lock", true)'
    pause 1.8
    js 'global.bn._sources.bluetooth.emit("connected", {icon: new Gio.ThemedIcon({name: "audio-headphones-symbolic"}), alias: "Nova Buds Pro", battery: 85})'
    pause 3.2
    js 'new Gio.Settings({schema_id: "org.gnome.desktop.notifications"}).set_boolean("show-banners", false)'
    pause 3.4
    js 'new Gio.Settings({schema_id: "org.gnome.desktop.notifications"}).set_boolean("show-banners", true)'
    pause 1
}
