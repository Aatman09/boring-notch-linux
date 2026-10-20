# Shared settings for the headless test scripts. Sourced, not run.
HERE=$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")
REPO=$(readlink -f "$HERE/../..")
UUID=boring-notch-linux@aatman09.github.io
T=${BN_TEST_DIR:-/tmp/bn-test-$USER}
bus() { cat "$T/bus"; }
shell_pid() { cat "$T/shell.pid" 2>/dev/null; }
# The headless shell's runtime dir (short path: Wayland sockets have a length limit).
runtime_dir() { tr '\0' '\n' < /proc/$(shell_pid)/environ | grep ^XDG_RUNTIME_DIR= | cut -d= -f2; }
