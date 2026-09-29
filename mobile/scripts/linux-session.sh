#!/usr/bin/env bash
# Runs a command that starts the app's Linux desktop build, in a container with
# no display and no desktop session: under Xvfb, inside a D-Bus session of its
# own whose Secret Service holds the session store's keychain.
#
# Usage: linux-session.sh <command> [arguments]
set -euo pipefail

linux_die() {
  printf 'linux: %s\n' "$*" >&2
  exit 1
}

for command in xvfb-run xauth dbus-run-session gnome-keyring-daemon pkg-config; do
  command -v "${command}" > /dev/null ||
    linux_die "${command} is missing; run: task mobile:linux-install"
done
# flutter_secure_storage_linux builds against it, and a CMake configure that
# fails on it leaves a cache the next build cannot install from.
pkg-config --exists libsecret-1 ||
  linux_die "libsecret-1 is missing; run: task mobile:linux-install"

# The keyring and whatever the app keeps start empty and are gone afterwards,
# as on a device the app has just been installed on.
XDG_DATA_HOME="$(mktemp -d)"
export XDG_DATA_HOME
trap 'rm -rf "${XDG_DATA_HOME}"' EXIT

# A keyring unlocked with a password creates the login collection without
# prompting, which it would otherwise try to do on a display it cannot open.
# The daemon lives on the session bus and ends with it.
# shellcheck disable=SC2016 # expanded by the inner shell
dbus-run-session -- bash -c '
  printf publira | gnome-keyring-daemon --unlock --components=secrets > /dev/null
  exec xvfb-run --auto-servernum --server-args="-screen 0 1280x1024x24" "$@"
' linux-session "$@"
