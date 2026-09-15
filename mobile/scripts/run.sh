#!/usr/bin/env bash
# Run the app on a device or emulator against the worktree's selected
# development profile. Arguments are passed on to `flutter run`.
set -euo pipefail

# shellcheck source=./app-config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-config.sh"

mobile_load_app_config "$(mobile_host_address)"
mapfile -t defines < <(
  mobile_dart_defines "${PUBLIRA_API_BASE_URL}" "${PUBLIRA_IMAGE_BASE_URL}"
)

printf 'profile %s: api %s, images %s, tenant %s\n' \
  "${MOBILE_PROFILE_NAME}" "${PUBLIRA_API_BASE_URL}" \
  "${PUBLIRA_IMAGE_BASE_URL}" "${PUBLIRA_TENANT_HOST}"

cd "${MOBILE_DIR}"
exec flutter run "${defines[@]}" "$@"
