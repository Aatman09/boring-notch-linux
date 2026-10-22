# Drag and drop: a file dragged from Files onto the notch lands on the shelf.
AREA="440 0 1040 760"
LENGTH=11

setup() {
    local docs=$T/home/Documents
    mkdir -p "$docs"
    echo "Q3 numbers" > "$docs/Quarterly report.pdf"
    echo "agenda" > "$docs/Meeting notes.txt"
    python3 -I -c "
from PIL import Image, ImageDraw
im = Image.new('RGB', (1200, 800), (255, 196, 120))
ImageDraw.Draw(im).ellipse((420, 220, 780, 580), fill=(250, 120, 90))
im.save('$docs/Trip photo.png')"
    js "new Gio.Settings({schema_id: 'org.gnome.desktop.interface'}).set_string('color-scheme', 'prefer-dark')"
    js "global.bn._sources.shelf.add('$docs/Trip photo.png')"
    js "Gio.Subprocess.new(['nautilus', '--new-window', '$docs'], Gio.SubprocessFlags.NONE)"
    pause 6
    js "global.display.list_all_windows().find(w => w.get_wm_class() === 'org.gnome.Nautilus').move_resize_frame(false, 640, 330, 640, 380)"
    js 'global.demo.move(1120, 900, 10)'
    pause 2
}

scene() {
    pause 1
    move 837 423 800
    pause 0.4
    js 'global.demo.press()'
    pause 0.2
    move 850 405 200
    move 900 240 500
    move 960 22 600
    pause 0.7
    move 960 150 450
    pause 1
    js 'global.demo.release()'
    pause 2.4
    move 1120 900 700
    pause 1.2
}
