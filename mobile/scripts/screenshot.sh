#!/usr/bin/env bash
# Photograph screens of the app against the worktree's selected development
# profile, one PNG per route named on the command line.
#
# A device or emulator is the picture a reader would see, so an attached one is
# what the screens are taken on. With none attached -- a Dev Container where
# `task mobile:android-install` has not run -- the same app is built for the
# web and served beside its two backends on one origin
# (scripts/web_app_server.dart). What that draws
# is the app's own widgets against the profile's own data; what it cannot draw
# is the platform around them, the status bar and the system navigation.
set -euo pipefail

# shellcheck source=./app-config.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-config.sh"

# The development flavor, whose application id `mobile/README.md` tabulates.
# `default-flavor: dev` in pubspec.yaml is what a build with no `--flavor`
# produces, so this is the one that gets installed.
readonly APP_ID='com.publira.publira.dev'
readonly APK='build/app/outputs/flutter-apk/app-dev-debug.apk'

out_dir="${MOBILE_DIR}/.run/screenshots"
# Long enough for the app to boot, resolve the tenant, read its page of the
# catalog, and fetch the covers on it.
wait_ms="${MOBILE_SCREENSHOT_WAIT_MS:-8000}"

routes=("$@")
if [[ "${#routes[@]}" -eq 0 ]]; then
  routes=("/")
fi

# `/` is the catalog, the screen the app opens on.
route_name() {
  local name="${1#/}"
  name="${name//\//-}"
  printf '%s\n' "${name:-catalog}"
}

# A profile that is not running would be photographed as the screen that says
# it could not be reached, a build after the command that asked for it. The
# check is made on loopback whichever address the app is given, because the one
# it is given is a device's view of this machine rather than this machine's.
require_profile_stack() {
  wait4x http "http://127.0.0.1:${PUBLIRA_PUBLIC_API_PORT}/readyz" --timeout 5s
  wait4x http "http://127.0.0.1:${PUBLIRA_IMAGE_SERVER_PORT}/readyz" --timeout 5s
}

screenshot_on_device() {
  local device="$1" activity route name attempt
  mobile_load_app_config "$(mobile_device_address "${device}")"
  mobile_bind_device_ports "${device}"
  printf 'profile %s on %s: api %s, images %s, tenant %s\n' \
    "${MOBILE_PROFILE_NAME}" "${device}" "${PUBLIRA_API_BASE_URL}" \
    "${PUBLIRA_IMAGE_BASE_URL}" "${PUBLIRA_TENANT_HOST}"
  require_profile_stack

  mapfile -t defines < <(
    mobile_dart_defines "${PUBLIRA_API_BASE_URL}" "${PUBLIRA_IMAGE_BASE_URL}"
  )
  flutter build apk --debug "${defines[@]}"
  adb -s "${device}" install -r "${APK}"
  activity="$(adb -s "${device}" shell cmd package resolve-activity --brief "${APP_ID}" | tail -1 | tr -d '\r')"

  for route in "${routes[@]}"; do
    name="$(route_name "${route}")"
    # The route reaches a launch rather than a running app, so each screen
    # starts from a process of its own: `route` is the initial route Flutter's
    # Android embedding reads off the intent, and a resumed activity would
    # keep the screen it was left on instead.
    adb -s "${device}" shell am force-stop "${APP_ID}"
    adb -s "${device}" shell am start -n "${activity}" --es route "${route}" >/dev/null
    for attempt in $(seq 60); do
      if adb -s "${device}" shell dumpsys window | grep -q "mCurrentFocus.*${APP_ID}"; then
        break
      fi
      # An app that crashes on launch never takes focus, and waiting for it
      # forever is a run with no picture and no message either.
      [[ "${attempt}" -lt 60 ]] ||
        dev_env_die "${APP_ID} never took focus on ${device} for route ${route}"
      sleep 1
    done
    sleep "$(awk -v milliseconds="${wait_ms}" 'BEGIN { print milliseconds / 1000 }')"
    adb -s "${device}" exec-out screencap -p >"${out_dir}/${name}.png"
    printf 'captured %s\n' "${out_dir}/${name}.png"
  done
}

# The one-origin server, while it is running. Not local to the function that
# starts it: the trap that stops it runs as the script exits, where a local of
# a function that has already returned is an unset variable.
server_pid=''

stop_web_app_server() {
  [[ -z "${server_pid}" ]] || kill "${server_pid}" 2>/dev/null || true
}

screenshot_in_browser() {
  local api_base_url image_base_url port origin route name
  mobile_load_app_config 127.0.0.1
  api_base_url="${PUBLIRA_API_BASE_URL}"
  image_base_url="${PUBLIRA_IMAGE_BASE_URL}"
  printf 'profile %s in a browser: api %s, images %s, tenant %s\n' \
    "${MOBILE_PROFILE_NAME}" "${api_base_url}" "${image_base_url}" \
    "${PUBLIRA_TENANT_HOST}"
  require_profile_stack

  # A profile owns the whole thousand its ports are numbered in, and hands them
  # out in tens: the edge takes the fiftieth, this takes the sixtieth. The
  # number is compiled into the build, which is why it is derived rather than
  # picked from whatever is free.
  port="$((PUBLIRA_WEB_HOST_PORT + 60))"
  origin="http://127.0.0.1:${port}"
  mapfile -t defines < <(mobile_dart_defines "${origin}" "${origin}")
  flutter build web "${defines[@]}"

  dart run scripts/web_app_server.dart \
    --port "${port}" --api "${api_base_url}" --images "${image_base_url}" \
    --root build/web &
  server_pid=$!
  trap stop_web_app_server EXIT
  wait4x http "${origin}/index.html" --timeout 30s

  for route in "${routes[@]}"; do
    name="$(route_name "${route}")"
    # go_router runs on Flutter's default URL strategy, which keeps the route
    # in the fragment, so the server is asked for the one page either way.
    pnpm --dir "${REPO_ROOT}/e2e" exec playwright screenshot \
      --device="${MOBILE_SCREENSHOT_DEVICE:-Pixel 7}" \
      --block-service-workers \
      --wait-for-timeout="${wait_ms}" \
      "${origin}/#${route}" "${out_dir}/${name}.png"
  done
}

cd "${MOBILE_DIR}"
mkdir -p "${out_dir}"

device="$(mobile_attached_device)"
if [[ -n "${device}" ]]; then
  screenshot_on_device "${device}"
else
  screenshot_in_browser
fi

printf 'screenshots in %s\n' "${out_dir}"
