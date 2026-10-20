#!/bin/bash
# Starts PipeWire inside the headless session with no hardware, and a silent
# sink as the default output, for testing the audio visualizer.
. "$(dirname "$(readlink -f "$0")")/common.sh"
export HOME=$T/home XDG_RUNTIME_DIR=$(runtime_dir) XDG_CONFIG_HOME=$T/config DBUS_SESSION_BUS_ADDRESS=$(bus)
mkdir -p "$T/config/wireplumber/wireplumber.conf.d"
cp "$HERE/wireplumber/no-hardware.conf" "$T/config/wireplumber/wireplumber.conf.d/"
gst-inspect-1.0 >/dev/null 2>&1   # builds GStreamer's plugin cache for this home
pipewire > "$T/pipewire.log" 2>&1 &
timeout 1 tail -f /dev/null
wireplumber > "$T/wireplumber.log" 2>&1 &
pipewire-pulse > "$T/pipewire-pulse.log" 2>&1 &
timeout 2 tail -f /dev/null
pactl load-module module-null-sink sink_name=testsink >/dev/null && pactl set-default-sink testsink && echo "audio ready"
