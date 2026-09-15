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

# The address a device sees this machine at. Loopback inside an emulator is the
# emulator, so a stack running here is reached at 10.0.2.2 from one.
mobile_host_address() {
  if adb devices 2>/dev/null | grep -q 'emulator'; then
    printf '10.0.2.2\n'
  else
    printf '127.0.0.1\n'
  fi
}
