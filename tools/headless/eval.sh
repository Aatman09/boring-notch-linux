#!/bin/bash
# Runs JavaScript inside the headless shell. Usage: eval.sh 'code'
. "$(dirname "$(readlink -f "$0")")/common.sh"
DBUS_SESSION_BUS_ADDRESS=$(bus) gdbus call --session --dest org.gnome.Shell \
  --object-path /org/gnome/Shell --method org.gnome.Shell.Eval "$1"
