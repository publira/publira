#!/usr/bin/env bash
# Install what the app's Linux desktop build needs in the Dev Container beyond
# the toolchain Flutter already finds there: an X server to draw into, and a
# Secret Service for the session store. Running it again installs only what is
# missing.
set -euo pipefail

packages=()
command -v xvfb-run > /dev/null || packages+=(xvfb xauth)
command -v dbus-run-session > /dev/null || packages+=(dbus-daemon)
command -v gnome-keyring-daemon > /dev/null || packages+=(gnome-keyring)
pkg-config --exists libsecret-1 2> /dev/null || packages+=(libsecret-1-dev)

if [[ "${#packages[@]}" -eq 0 ]]; then
  printf 'linux: everything is installed\n'
  exit 0
fi

printf 'linux: installing %s\n' "${packages[*]}"
sudo apt-get update -q
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends "${packages[@]}"
