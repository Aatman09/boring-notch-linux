# The System tab with half a minute of real readings, then synced lyrics
# under the artist.
AREA="360 0 1200 330"
LENGTH=15

setup() {
    player cover-golden.png "Golden Hour Drive@Nova Lane"
    js 'global.demo.lyrics(["[01:10.00]Windows down on the coast road", "[01:13.50]Chasing the last of the light", "[01:17.00]Every song sounds like summer", "[01:20.50]When you are here in the night", "[01:24.00]Golden hour, golden hour", "[01:27.50]Hold it a little more", "[01:31.00]Windows down on the coast road", "[01:34.50]Chasing the last of the light", "[01:38.00]Every song sounds like summer", "[01:41.50]When you are here in the night", "[01:45.00]Golden hour, golden hour", "[01:48.50]Hold it a little more", "[01:52.00]Windows down on the coast road", "[01:55.50]Chasing the last of the light", "[01:59.00]Every song sounds like summer", "[02:02.50]When you are here in the night"])'
    setting boolean show-lyrics true
    setting boolean show-system-tab true
    # The System tab fills its graphs while it is open: open it well before
    # the recording starts.
    js 'global.demo.move(960, 16, 400)'
    pause 1.5
    js 'global.demo.move(1000, 160, 300)'
    pause 0.6
    tab system
    pause 31
}

scene() {
    pause 4.5
    tab home
    pause 7.5
    move 980 700 600
    pause 1.2
}
