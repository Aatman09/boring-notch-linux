#!/bin/bash
# Plays a tone into the headless session's silent sink. Usage: tone.sh <hz>
. "$(dirname "$(readlink -f "$0")")/common.sh"
HOME=$T/home XDG_RUNTIME_DIR=$(runtime_dir) exec gst-launch-1.0 -q audiotestsrc freq="$1" volume=0.5 ! pulsesink
