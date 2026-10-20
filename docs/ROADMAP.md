# Roadmap

What to add next, in order. This merges two detailed plans:

- [boring.notch gaps](plans/boring-notch-gaps.md): every feature and setting
  of the macOS original that this port doesn't have yet, about 40 items.
- [Other notch apps](plans/other-notch-apps.md): features from NotchNook,
  Alcove, DynamicLake, Atoll, DynamicNotch, the iPhone's Dynamic Island,
  NexNotch and others, 29 items.

Each item in those plans covers what the feature does, the GNOME API it
would use (checked against the GNOME Shell 50 sources), which files change,
new settings, how to test it, risks and effort. This page only sets the
order. Section numbers such as **(G-7.2)** point into the boring.notch plan,
and **(O-F15)** into the other-apps plan.

Effort: **S** about a day, **M** a few days, **L** a week or more.

## Rules every feature follows

- **No idle cost.** Features react to D-Bus signals or file events. Anything
  that ticks runs only while its view is on screen. Measure CPU with the
  feature on and off; the idle notch stays near today's 0.6%.
- **Clean disable.** Every signal, timeout, keybinding, injection,
  subprocess and D-Bus name is undone in `disable()`. Test with enable →
  disable → enable and check the log for errors.
- **Private GNOME internals** are guarded, and the feature turns itself off
  quietly if they're missing.
- **Privacy:** anything that reads the clipboard, uses the network, or shows
  phone data starts off.

## Phase 0: groundwork

Do these first; most later features depend on them.

| Item | Why | Effort |
|---|---|---|
| Peek queue with priorities **(O-G1)** | Today a new peek replaces the one showing. With more peeks, a burst (for example on resume from suspend) would flicker. | S |
| Fix the jump when a peek ends | When the volume peek ends, the fading content is re-laid out at the new width in one frame. Lay out each closed view at its own width. | S |
| A shared "status peek" view and a `sources` object for the island **(O-G2)** | Most new peeks are icon + title + detail. Stops the island's constructor from growing with every feature. | S |
| Settings split into pages, plus an About page **(G-9.3)** | The settings window will have too many switches for one page. | S |

## Phase 1: interaction (release 1.1)

| Item | Effort | Value |
|---|---|---|
| Gestures: scroll on the notch for volume, swipe to skip tracks, middle-click play/pause, two-finger swipe down to open **(G-7.1, O-F15)** | S | High |
| Keyboard shortcuts to toggle the notch and the music peek **(G-7.2)** | S | High |
| Music peek when the track changes **(G-1.1)** | S | High |
| Choice of player buttons, including volume and ±15 s **(G-1.2)** | S–M | Medium |
| Volume and brightness shown inside the open notch **(G-2.3)** | S | Medium |
| Right-click menu, remember the last tab, pause-linger setting **(G-7.3, G-7.4, G-1.7)** | S | Low–Medium |

## Phase 2: system awareness (release 1.2)

| Item | Effort | Value |
|---|---|---|
| Microphone, camera and screen-share dots, with the app's name in a peek **(O-F1)** | S–M | High |
| Screenshot thumbnail peek **(O-F7)** | S–M | High |
| Bluetooth connect with earbud battery, merged with an audio-output-switch peek **(O-F2, O-F3)** | S–M | High |
| Do Not Disturb indicator, and a DND switch on the Today tab **(O-F5)** | S | Medium–High |
| Low, critical and fully charged battery peeks, and display options **(O-F4, G-3.2)** | S | Medium–High |
| Caps Lock and keyboard-layout peeks, screen-recording live activity **(O-F10, O-F6)** | S | Medium |

## Phase 3: the boring.notch look (release 1.3)

| Item | Effort | Value |
|---|---|---|
| Colours from the album art for the bars, text and progress bar **(G-1.3, O-F16)** | S–M | Medium |
| Album-art glow, dimmed art when paused, app badge **(G-1.4)** | S | Medium |
| Scrolling long titles **(G-1.6)** | S | Medium |
| Accent colour, row-style and draggable volume bar, shadow **(G-8.2, G-2.1, G-2.2, G-8.1)** | S–M | Low–Medium |

## Phase 4: information (release 1.4)

| Item | Effort | Value |
|---|---|---|
| Next-meeting countdown in the closed notch **(O-F8)** | M | High |
| A D-Bus API so any app or script can post a live activity, plus real download and copy progress from the LauncherEntry signal Ubuntu Dock uses **(O-F21)** | M | High |
| Buttons on notification peeks **(O-F24)** | S–M | Medium–High |
| Weather on the Today tab **(O-F13)** | S–M | Medium–High |
| Calendar colours, hiding all-day events, choosing calendars, "Up next" on Home **(G-4.1, G-4.2, G-4.4)** | M | Medium |
| Battery details popover and power-saver peek **(G-3.1, G-3.3)** | M | Medium |
| Preferred and ignored players, fullscreen behaviour **(G-1.9, G-1.8)** | S–M | Low–Medium |

## Phase 5: bigger features

| Item | Effort | Value | Note |
|---|---|---|---|
| Shelf, step 1: a tab for files from paste, downloads and screenshots, with Quick Look **(G-5.1)** | M | High | Works without drag and drop. |
| Shelf, step 2: drop files onto the notch **(G-5.2, O-F20)** | L | High | GNOME Shell sees a drag but can't receive the files, so this needs a small helper window. Test on a real session before turning it on by default. |
| Quick Share from the shelf (GSConnect, Bluetooth, LocalSend, email) **(G-5.4)** | S–M | Medium | |
| Pomodoro and stopwatch on the Timer tab **(O-F14)** | S | Medium | |
| Clipboard history tab **(O-F18)** | M | Medium–High | Off by default. |
| Synced lyrics **(G-1.5, O-F17)** | M | Medium | Off by default: sends the track name to lrclib.net. |
| Choice of monitor, then all monitors **(G-9.1, O-F25)** | M–L | Medium for multi-monitor setups | |
| System monitor tab **(O-F19)** | M | Medium | Samples only while open. |

## Backlog

- **Webcam mirror (G-6, O-F28).** The two plans disagree. One rates it
  medium effort, running GStreamer in a separate process like the visualizer
  does. The other says skip it, as high cost while on and of little use.
  Leave it until it's asked for.
- Tasks and reminders through Evolution Data Server **(G-4.3)**: needs
  libraries that aren't installed by default.
- Dragging files out of the shelf **(G-5.3)**, lock-screen widgets
  **(G-9.5, O-F27)**, idle face **(G-8.3)**, hover effects **(O-F26)**,
  GSConnect phone battery and calls **(O-F12)**, workspace indicator
  **(O-F11)**, Wi-Fi and VPN peeks **(O-F9)**, drive-mount peek **(O-F22)**,
  quick toggles **(O-F23)**, colour picker **(O-F29)**.

## Not planned

These don't make sense on GNOME or aren't possible: Lottie visualizers,
haptics, hiding from screen recordings, Option-key media-key actions, image
background removal, a "favourite" button (MPRIS has no like method), and
macOS app-store chores such as updates and launch at login. Navigation,
sports scores and deliveries have no desktop data source; the live-activity
API in phase 4 could carry them if an app sends them.

## About testing

The plans refer to a headless test setup (`start-headless.sh`, `sh-eval.sh`,
`shot.sh`, a fake MPRIS player). Those scripts were used during development
but aren't in this repository yet. Each plan's test steps describe what they
do: a GNOME Shell started with `--headless --virtual-monitor` on its own
D-Bus session, driven through `org.gnome.Shell.Eval` and screenshots.
