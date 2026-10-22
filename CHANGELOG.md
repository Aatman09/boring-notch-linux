# Changelog

## 1.1.2 (2026-10-22)

### Fixed
- The music peek shows only when a different track starts. Pausing and
  playing again, or seeking forward and back (which browsers report as a
  short pause while they buffer), no longer make it pop up.

## 1.1.1 (2026-10-22)

### Fixed
- The calendar and notification cards stay readable with Blur my Shell
  enabled in the light style. Blur my Shell restyles GNOME's calendar and
  message list everywhere, the notch included, with `!important` colours;
  the notch now keeps its own.

## 1.1 (2026-10-22)

### New
- **Shelf tab:** files from paste, finished downloads and new screenshots,
  with Open, Show in folder, Share and Remove. Drag files from Files or the
  desktop onto the notch to add them.
- **Quick Share** from the shelf: GSConnect, Bluetooth, LocalSend, email.
- **Clipboard history** in the Shelf tab (off by default, memory only).
- **Timer tab:** a stopwatch and a Pomodoro beside the countdown.
- **Today tab:** calendar colours, hiding all-day events, weather (off by
  default), and "Up next" on Home when nothing plays.
- **Live activities:** the next meeting ("in 12 min"), the screen recording,
  progress that apps report (browser downloads, file copies), and a D-Bus API
  for scripts (`org.gnome.Shell.Extensions.BoringNotch`).
- **Peeks:** buttons on notifications, the sound output, privacy (microphone,
  camera, screen sharing), screenshots as thumbnails, Bluetooth with battery,
  Do Not Disturb, Caps Lock and keyboard layout, low and full battery, Power
  Saver.
- **Music:** colours from the album art, a glow behind the cover, scrolling
  titles, synced lyrics (off by default), preferred and ignored players.
- **System tab** (off by default): processor, memory, network, temperature.
- **Battery details** from the header: time left, health, energy rate.
- **Volume:** a row style, the percentage, and a bar you can drag.
- **Settings:** accent colour, the display that shows the notch, gestures,
  shortcuts, player buttons, and a switch for each feature.

### Fixed
- The calendar and notification cards are readable in GNOME's light style.
- Calendar events no longer disappear when the meeting countdown is on.
- The cover glow no longer pushes the cover away from its title.
- A notification's text uses the whole peek instead of stopping halfway.
- The battery panel fits inside the open notch.
- Sharper placement at fractional scales and on a second display.

### Inside
- The notch is split into modules: the peek queue, system peeks, live
  activities, one file per tab.
- Headless tests in `tools/headless` for every feature, and
  `tools/demo/demo.sh` to record the demo clips.

## 1.0 (2026-10-20)

The first release: music with a visualizer, volume and brightness in the
notch, notifications, the Today tab with GNOME's calendar, a timer,
downloads and battery activity.
