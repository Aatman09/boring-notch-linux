# Boring Notch for GNOME

A Dynamic Island for the GNOME top bar. It's a Linux port of
[boring.notch](https://github.com/TheBoredTeam/boring.notch), rewritten as a
GNOME Shell extension because the original is built on macOS-only frameworks.

The notch sits in the middle of the top bar and springs open when you rest
the pointer on it.

## Features

- **Clock and notifications:** the top bar clock moves into the notch, with a
  dot when notifications are waiting. Clicking the notch or pressing Super+V
  opens the **Today** tab: GNOME's own notification list on the left, and the
  month calendar with the selected day's events on the right.
- **Notification peeks:** new notifications slide out of the notch instead of
  showing GNOME banners. Click one to open it. Critical notifications still
  use the GNOME banner.
- **Music:** album art and animated bars in the closed notch while something
  plays. The Home tab has the full player with seek bar, shuffle, previous,
  play/pause, next and repeat. This works with any MPRIS player (Spotify,
  Firefox, Chromium, Rhythmbox, VLC and most others).
- **Timer:** the Timer tab has 1–25 minute presets. While it runs, the
  countdown shows in the closed notch, and it chimes when done.
- **Downloads:** browser downloads show while they run, and a peek with the
  file name when they finish. Click it to open the Downloads folder.
- **Volume and brightness:** changes appear inside the notch instead of the
  GNOME popup.
- **Battery:** a peek when a charger is plugged in or removed, and the charge
  level in the header.
- **Settings:** size, hover to open, hover delay, notch width, clock
  placement, and each live activity can be turned off.

## Cost

Measured in GNOME Shell's CPU use with the notch closed:

| State | CPU |
|---|---|
| Extension off | 0.3% |
| Idle or paused | 0.6% |
| Music playing, visualizer on | 1.2% |
| Open, music playing | 1.0% |

Memory use is under 1 MB. Nothing polls when idle: the notch reacts to D-Bus
signals and file events, and only redraws while it animates.

The notch size, corner radii and spring physics are copied from boring.notch:
640×190 when open, a response of 0.42 s and damping of 0.8 when opening, and
0.45 s and 1.0 when closing.

## Install

Requires GNOME Shell 50.

```sh
make install
```

On Wayland, log out and back in, then:

```sh
gnome-extensions enable boring-notch-linux@aatman09.github.io
```

Settings: `gnome-extensions prefs boring-notch-linux@aatman09.github.io`, or
use the gear icon in the open notch.

## How it maps to boring.notch

| boring.notch (Swift) | This extension |
|---|---|
| `NotchShape.swift` | `src/notchShape.js` (same curves, drawn with Cairo) |
| SwiftUI springs | `src/spring.js` (same parameters) |
| `MusicManager` and per-app controllers | `src/media.js` (MPRIS over D-Bus) |
| `BatteryActivityManager` | `src/battery.js` (UPower) |
| `InlineHUD`, `MusicLiveActivity` | `src/closedViews.js` |
| `NotchHomeView`, `BoringHeader` | `src/openView.js` |
| `ContentView` state and hover handling | `src/island.js` |
| `DownloadView` | `src/downloads.js` (watches the Downloads folder) |

## License

GPL-3.0, like boring.notch. Shape code originally from
[DynamicNotchKit](https://github.com/MrKai77/DynamicNotchKit).
