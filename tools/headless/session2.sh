#!/bin/bash
# Starts an isolated headless GNOME Shell with two virtual monitors and the
# extension from this repo; the same as session.sh otherwise.
# Usage: session2.sh [--fractional] [WxH WxH]   (run it in the background)
#   --fractional: 125% display scale and 1.25 text scaling, like the author's setup.
. "$(dirname "$(readlink -f "$0")")/common.sh"
FRACTIONAL=; [ "$1" = --fractional ] && { FRACTIONAL=1; shift; }
MONITOR=${1:-1920x1080}
MONITOR2=${2:-1280x720}
rm -rf "$T"; mkdir -p "$T"/{home,config,cache,data/gnome-shell/extensions}
ln -s "$REPO" "$T/data/gnome-shell/extensions/$UUID"
ln -s "$HERE/devtools@local" "$T/data/gnome-shell/extensions/devtools@local"
RT=$(mktemp -d /tmp/bnrt.XXXX); chmod 700 "$RT"
export HOME=$T/home XDG_RUNTIME_DIR=$RT XDG_CONFIG_HOME=$T/config XDG_DATA_HOME=$T/data XDG_CACHE_HOME=$T/cache
exec dbus-run-session -- bash -c "
  echo \$DBUS_SESSION_BUS_ADDRESS > '$T/bus'
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions \"['devtools@local','$UUID']\"
  gsettings set org.gnome.shell welcome-dialog-last-shown-version '999'
  if [ -n '$FRACTIONAL' ]; then
    gsettings set org.gnome.mutter experimental-features \"['scale-monitor-framebuffer']\"
    gsettings set org.gnome.desktop.interface text-scaling-factor 1.25
  fi
  gnome-shell --headless --wayland --no-x11 --virtual-monitor $MONITOR --virtual-monitor $MONITOR2 --force-animations > '$T/shell.log' 2>&1 &
  echo \$! > '$T/shell.pid'; wait"
