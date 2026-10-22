# Live activities: a timer counting down, the next meeting, an app's
# download progress and a screen recording.
AREA="460 0 1000 250"
LENGTH=19

setup() {
    js 'global.demo.move(960, 700, 10)'
}

scene() {
    pause 1
    js 'global.bn._sources.timer.start(185)'
    pause 3.6
    js 'global.bn._sources.timer.reset(); global.demo.events([[7, 30, "Design review"]])'
    pause 3.4
    js 'global.demo.events([])'
    DBUS_SESSION_BUS_ADDRESS=$(bus) python3 -I "$DEMO/progress.py" org.gnome.Nautilus.desktop 4.5 &
    pause 5.6
    js 'Main.screenshotUI._screencastInProgress = true; Main.screenshotUI.notify("screencast-in-progress")'
    pause 4.2
    js 'Main.screenshotUI._screencastInProgress = false; Main.screenshotUI.notify("screencast-in-progress")'
    pause 0.8
}
