#!/usr/bin/env bash
# Where the app connects, taken from the worktree's selected development
# profile rather than typed out as the shared default stack's 8000 / 8200.
#
# The app addresses each server directly, the way it does on a device, and not
# the profile's edge: the edge sets `X-Forwarded-Host` from the host name it
# was reached on, and that header is how the app -- which reaches a loopback
# address or an emulator's `10.0.2.2`, never a tenant's domain -- says which
# tenant it is asking about. Through the edge every image is answered 404.
# shellcheck shell=bash

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=../../scripts/dev-env/lib.sh
source "${REPO_ROOT}/scripts/dev-env/lib.sh"

# Loads the selected profile and sets the three `--dart-define` values from it,
# leaving a value already exported alone so that a stack of another kind can be
# named on the command line.
#
# $1 is the address the app reaches the profile's ports on: loopback for a
# build running on this machine, `10.0.2.2` for one running in an Android
# emulator, where loopback is the emulator itself.
mobile_load_app_config() {
  local host="${1:-127.0.0.1}" selected
  selected="$(dev_env_read_selection)" ||
    dev_env_die "no profile is selected; run: task dev-env:create NAME=<name>"
  dev_env_load_profile "${selected}"

  MOBILE_PROFILE_NAME="${selected}"
  PUBLIRA_API_BASE_URL="${PUBLIRA_API_BASE_URL:-http://${host}:${PUBLIRA_PUBLIC_API_PORT}}"
  PUBLIRA_IMAGE_BASE_URL="${PUBLIRA_IMAGE_BASE_URL:-http://${host}:${PUBLIRA_IMAGE_SERVER_PORT}}"
  # Every profile is seeded from `db/seeds/dev`, whose tenant answers to this
  # one domain whichever ports the profile listens on.
  PUBLIRA_TENANT_HOST="${PUBLIRA_TENANT_HOST:-localhost}"
  export MOBILE_PROFILE_NAME PUBLIRA_API_BASE_URL PUBLIRA_IMAGE_BASE_URL PUBLIRA_TENANT_HOST
}

# The three defines, given the pair of addresses this build is to use: the
# profile's own ports for a build on a device, and the one-origin server below
# for a build in a browser.
mobile_dart_defines() {
  local api="$1" images="$2"
  printf '%s\n' \
    "--dart-define=PUBLIRA_API_BASE_URL=${api}" \
    "--dart-define=PUBLIRA_IMAGE_BASE_URL=${images}" \
    "--dart-define=PUBLIRA_TENANT_HOST=${PUBLIRA_TENANT_HOST}"
}

# The address this machine answers on as seen from $1, the device the build
# will run on. Loopback inside an emulator is the emulator itself, which is
# what 10.0.2.2 exists for. A device on a cable has no route here at all, so it
# is given its own loopback and mobile_bind_device_ports puts this machine's
# ports behind it. An empty serial is a build that runs here (`-d chrome`,
# `-d linux`), where loopback is already this machine.
mobile_device_address() {
  case "$1" in
    emulator-*) printf '10.0.2.2\n' ;;
    *) printf '127.0.0.1\n' ;;
  esac
}

# Binds the profile's two ports onto $1's own loopback, which is the address
# mobile_device_address answers with for anything but an emulator. Call it
# after mobile_load_app_config, which is what resolves the ports.
mobile_bind_device_ports() {
  local device="$1"
  case "${device}" in
    '' | emulator-*) return 0 ;;
  esac
  # A name adb does not answer for is a target of another kind -- `chrome`,
  # `linux`, an iOS simulator -- and each of those already runs here.
  adb -s "${device}" get-state >/dev/null 2>&1 || return 0
  adb -s "${device}" reverse "tcp:${PUBLIRA_PUBLIC_API_PORT}" "tcp:${PUBLIRA_PUBLIC_API_PORT}" >/dev/null
  adb -s "${device}" reverse "tcp:${PUBLIRA_IMAGE_SERVER_PORT}" "tcp:${PUBLIRA_IMAGE_SERVER_PORT}" >/dev/null
}

# The serial of the device to use: the one MOBILE_DEVICE names, else the first
# attached. Nothing at all when none is attached or `adb` is not installed --
# which is the Dev Container, whose image ships no Android SDK.
mobile_attached_device() {
  if [[ -n "${MOBILE_DEVICE:-}" ]]; then
    printf '%s\n' "${MOBILE_DEVICE}"
    return 0
  fi
  command -v adb >/dev/null 2>&1 || return 0
  adb devices 2>/dev/null | awk '$2 == "device" { print $1; exit }' || true
}
