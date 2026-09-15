#!/usr/bin/env bash
# Photograph screens of the app against the worktree's selected development
# profile, one PNG per route named on the command line.
#
# The app is built for the web and served beside its two backends on one
# origin (scripts/web_app_server.dart), because the Dev Container has no
# Android emulator to run it on. What that build draws is the app's own
# widgets against the profile's own data: the same screen, photographed by a
# browser instead of by a phone.
set -euo pipefail

# shellcheck source=./app-config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-config.sh"

mobile_load_app_config 127.0.0.1
api_base_url="${PUBLIRA_API_BASE_URL}"
image_base_url="${PUBLIRA_IMAGE_BASE_URL}"

# A profile owns the whole thousand its ports are numbered in, and hands them
# out in tens: the edge takes the fiftieth, this takes the sixtieth. The number
# is compiled into the build, which is why it is derived rather than picked
# from whatever is free.
port="$((PUBLIRA_WEB_HOST_PORT + 60))"
origin="http://127.0.0.1:${port}"
out_dir="${MOBILE_DIR}/.run/screenshots"
# Long enough for the app to boot, resolve the tenant, read its page of the
# catalog, and fetch the covers on it.
wait_ms="${MOBILE_SCREENSHOT_WAIT_MS:-8000}"
device="${MOBILE_SCREENSHOT_DEVICE:-Pixel 7}"

routes=("$@")
if [[ "${#routes[@]}" -eq 0 ]]; then
  routes=("/")
fi

cd "${MOBILE_DIR}"
mkdir -p "${out_dir}"

mapfile -t defines < <(mobile_dart_defines "${origin}" "${origin}")
printf 'profile %s: api %s, images %s, tenant %s\n' \
  "${MOBILE_PROFILE_NAME}" "${api_base_url}" "${image_base_url}" \
  "${PUBLIRA_TENANT_HOST}"

# A profile that is not running would be photographed as the screen that says
# it could not be reached, a minute after the build that produced it.
wait4x http "${api_base_url}/readyz" --timeout 5s
wait4x http "${image_base_url}/readyz" --timeout 5s

flutter build web "${defines[@]}"

dart run scripts/web_app_server.dart \
  --port "${port}" --api "${api_base_url}" --images "${image_base_url}" \
  --root build/web &
server_pid=$!
trap 'kill "${server_pid}" 2>/dev/null || true' EXIT
wait4x http "${origin}/index.html" --timeout 30s

for route in "${routes[@]}"; do
  name="${route#/}"
  name="${name//\//-}"
  # `/` is the catalog, the screen the app opens on.
  name="${name:-catalog}"
  # go_router runs on Flutter's default URL strategy, which keeps the route in
  # the fragment, so the server is asked for the one page either way.
  pnpm --dir "${REPO_ROOT}/e2e" exec playwright screenshot \
    --device="${device}" \
    --block-service-workers \
    --wait-for-timeout="${wait_ms}" \
    "${origin}/#${route}" "${out_dir}/${name}.png"
done

printf 'screenshots in %s\n' "${out_dir}"
