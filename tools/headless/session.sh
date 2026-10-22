#!/bin/bash
# Starts an isolated headless GNOME Shell with the extension from this repo.
# Usage: session.sh [--fractional] [WxH]   (run it in the background)
#   --fractional: 125% display scale and 1.25 text scaling, like the author's setup.
. "$(dirname "$(readlink -f "$0")")/common.sh"
FRACTIONAL=; [ "$1" = --fractional ] && { FRACTIONAL=1; shift; }
MONITOR=${1:-1920x1080}
# BN_KEEP="cache files": folders of the test home kept across this start,
# for tests that restart the shell and check what survived.
KEEP=
for d in ${BN_KEEP:-}; do [ -e "$T/$d" ] && mv "$T/$d" "$T.keep-$d" && KEEP="$KEEP $d"; done
rm -rf "$T"; mkdir -p "$T"/{home,config,cache,data/gnome-shell/extensions}
for d in $KEEP; do rm -rf "$T/$d" && mv "$T.keep-$d" "$T/$d"; done
# The folders the watchers need to exist when the shell starts, as on a desktop.
mkdir -p "$T"/home/{Downloads,Pictures}
printf 'XDG_DOWNLOAD_DIR="$HOME/Downloads"\nXDG_PICTURES_DIR="$HOME/Pictures"\n' > "$T/config/user-dirs.dirs"
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
  gnome-shell --headless --wayland --no-x11 --virtual-monitor $MONITOR --force-animations > '$T/shell.log' 2>&1 &
  echo \$! > '$T/shell.pid'; wait"
