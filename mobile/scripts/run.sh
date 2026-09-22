#!/usr/bin/env bash
# Run the app on a device or emulator against the worktree's selected
# development profile. Arguments are passed on to `flutter run`.
set -euo pipefail

# shellcheck source=./app-config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-config.sh"

# The device `flutter run` will use, so that the addresses compiled into the
# build are the ones that device can reach: the one the caller named, else the
# one PUBLIRA_MOBILE_DEVICE or adb answers with.
device=""
previous=""
for argument in "$@"; do
  case "${previous}" in
    -d | --device-id) device="${argument}" ;;
  esac
  case "${argument}" in
    --device-id=*) device="${argument#*=}" ;;
  esac
  previous="${argument}"
done
device="${device:-$(mobile_attached_device)}"

mobile_load_app_config "$(mobile_device_address "${device}")"
mobile_generate_build_config
mobile_bind_device_ports "${device}"
mapfile -t defines < <(
  mobile_dart_defines "${PUBLIRA_BASE_URL}"
)

printf 'profile %s on %s: server %s, tenant %s\n' \
  "${MOBILE_PROFILE_NAME}" "${device:-the default device}" \
  "${PUBLIRA_BASE_URL}" "${PUBLIRA_TENANT_HOST}"

cd "${MOBILE_DIR}"
exec flutter run "${defines[@]}" "$@"
