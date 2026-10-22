#!/bin/bash
# Records a demo scene of the notch in a headless GNOME Shell at 2x scale and
# encodes it for the web. Usage: demo.sh SCENE   (a file in scenes/, without .sh)
# Writes docs/media/SCENE.mp4, .webm, .gif and -poster.png.
set -e
DEMO=$(dirname "$(readlink -f "$0")")
HEADLESS=$DEMO/../headless
REPO=$(readlink -f "$DEMO/../..")
export BN_TEST_DIR=${BN_TEST_DIR:-/tmp/bn-test-demo}
. "$HEADLESS/common.sh"
OUT=$REPO/docs/media
WORK=$T/demo
mkdir -p "$OUT"

# Defaults a scene can change before sourcing: the area recorded (logical
# pixels of the 1920x1080 stage) and the length in seconds.
AREA="360 0 1200 640"
LENGTH=12

js() { "$HEADLESS/eval.sh" "$1" >/dev/null; }
pause() { timeout "$1" tail -f /dev/null || true; }
move() { js "global.demo.move($1, $2, ${3:-600})"; pause "$(awk -v ms="${3:-600}" 'BEGIN{print ms/1000}')"; }
click() { js 'global.demo.click()'; }
tab() { js "global.demo.tab('$1', 500)"; pause 0.7; }
setting() { js "global.bn._settings.set_$1('$2', $3)"; }
# A notification as an app sends it: notify APP ICON TITLE BODY [ACTIONS]
notify() {
    DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session --dest org.freedesktop.Notifications \
        --object-path /org/freedesktop/Notifications --method org.freedesktop.Notifications.Notify \
        "$1" 0 "$2" "$3" "$4" "${5:-[]}" "{}" 0 >/dev/null
}
player() { DBUS_SESSION_BUS_ADDRESS=$(bus) nohup gjs -m "$HEADLESS/fake-player.js" "$DEMO/assets/$1" "$2" > "$T/player.log" 2>&1 & echo $! > "$T/player.pid"; }

# A clean session: 3840x2160 at scale 2, text 1.25, PipeWire for the
# recorder, no notifications from the test setup.
"$HEADLESS/stop.sh" >/dev/null 2>&1 || true
("$HEADLESS/session.sh" --fractional 3840x2160 >/dev/null 2>&1 &)
sleep 1
"$HEADLESS/wait.sh" >/dev/null
DBUS_SESSION_BUS_ADDRESS=$(bus) python3 -I "$HEADLESS/set-scale.py" 2 >/dev/null
pause 2
"$HEADLESS/audio.sh" >/dev/null
"$HEADLESS/eval.sh" "$(cat "$DEMO/stage.js")" >/dev/null
setting boolean visualizer-follows-audio false
# The recording itself counts as screen sharing; its dot is not part of a demo.
setting boolean show-privacy-indicators false
js "for (const key of ['picture-uri', 'picture-uri-dark']) new Gio.Settings({schema_id: 'org.gnome.desktop.background'}).set_string(key, 'file://$DEMO/assets/wallpaper.png')"
js 'global.demo.clear()'
rm -rf "$WORK"; mkdir -p "$WORK"

# The scene: `setup` runs before recording, `scene` while it records.
. "$DEMO/scenes/$1.sh"
declare -F setup >/dev/null && setup
pause 1
read -r X Y W H <<< "$AREA"
DBUS_SESSION_BUS_ADDRESS=$(bus) python3 -I "$DEMO/screencast.py" "$X" "$Y" "$W" "$H" "$WORK/raw" "$LENGTH" > "$WORK/screencast.log" &
REC=$!
pause 0.5
scene
wait $REC
[ -s "$WORK/raw.mp4" ] || { echo "no recording: $(cat "$WORK/screencast.log")"; exit 1; }
kill "$(cat "$T/player.pid" 2>/dev/null)" 2>/dev/null || true

# Web encodes: constant 60 fps H.264 (plays everywhere), VP9, a GIF at a
# README-friendly width, and a poster frame.
CUT="-ss 0.4"
ffmpeg -v error -y $CUT -i "$WORK/raw.mp4" -vf "fps=60,scale=1600:-2:flags=lanczos,format=yuv420p" \
    -c:v libx264 -preset slow -crf 20 -movflags +faststart -an "$OUT/$1.mp4"
ffmpeg -v error -y $CUT -i "$WORK/raw.mp4" -vf "fps=60,scale=1600:-2:flags=lanczos" \
    -c:v libvpx-vp9 -b:v 0 -crf 34 -row-mt 1 -an "$OUT/$1.webm"
ffmpeg -v error -y $CUT -i "$WORK/raw.mp4" -vf "fps=25,scale=880:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" \
    "$OUT/$1.gif"
ffmpeg -v error -y -sseof -1.2 -i "$WORK/raw.mp4" -frames:v 1 -vf "scale=1600:-2:flags=lanczos" "$OUT/$1-poster.png"
"$HEADLESS/stop.sh" >/dev/null 2>&1 || true
ls -la "$OUT/$1".* "$OUT/$1-poster.png" | awk '{print $NF, $5}'
