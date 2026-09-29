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

# `default-flavor: dev` in pubspec.yaml is what a build with no `--flavor`
# produces, so the development flavor is the one that gets installed.
readonly APK='build/app/outputs/flutter-apk/app-dev-debug.apk'

out_dir="${MOBILE_DIR}/.run/screenshots"
# Long enough for the app to boot, resolve the tenant, read its page of the
# catalog, and fetch the covers on it.
wait_ms="${PUBLIRA_MOBILE_SCREENSHOT_WAIT_MS:-8000}"

# The development-seed reader every screen is photographed signed in as, so a
# screen only a reader reaches shows itself rather than the signed-out notice.
# Named empty, the screens are photographed signed out.
reader="${PUBLIRA_MOBILE_SCREENSHOT_READER-member@example.com}"
# Every account the development seed holds has the password its address's
# local part followed by `pass`.
reader_password="${PUBLIRA_MOBILE_SCREENSHOT_PASSWORD:-${reader%%@*}pass}"

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
}

# Calls $1 on the profile's public API with the JSON body $2, and the tenant
# header $3 when one is given.
call_public_api() {
  local procedure="$1" body="$2" tenant="${3:-}" response
  local -a headers=(-H 'content-type: application/json')
  [[ -z "${tenant}" ]] || headers+=(-H "x-publira-tenant-id: ${tenant}")
  response="$(curl -sS --fail-with-body "${headers[@]}" --data "${body}" \
    "http://127.0.0.1:${PUBLIRA_PUBLIC_API_PORT}/api/publira.v1.${procedure}")" ||
    dev_env_die "${procedure} failed: ${response}"
  printf '%s\n' "${response}"
}

# The define that starts the app signed in as the reader, empty for a run
# photographed signed out. Either way the build holds its session in memory,
# so the session a device already keeps is neither shown nor replaced.
session_define='--dart-define=PUBLIRA_SESSION_TOKEN='

sign_in_reader() {
  local response tenant token
  [[ -n "${reader}" ]] || return 0
  response="$(call_public_api DomainService/GetTenantByDomain \
    "$(jq -n --arg host "${PUBLIRA_TENANT_HOST}" '{domains: [$host]}')")" ||
    exit 1
  tenant="$(jq -r '.tenantId // empty' <<< "${response}")"
  [[ -n "${tenant}" ]] ||
    dev_env_die "no tenant is served on ${PUBLIRA_TENANT_HOST}"
  response="$(call_public_api AuthService/Login \
    "$(jq -n --arg tenant "${tenant}" --arg email "${reader}" \
      --arg password "${reader_password}" \
      '{tenant: {tenantId: $tenant}, email: $email, password: $password}')" \
    "${tenant}")" || exit 1
  token="$(jq -r '.accessToken.token // empty' <<< "${response}")"
  [[ -n "${token}" ]] || dev_env_die "Login answered ${reader} with no token"
  session_define="--dart-define=PUBLIRA_SESSION_TOKEN=${token}"
  printf 'signed in as %s\n' "${reader}"
}

screenshot_on_device() {
  local device="$1" app_id activity route name attempt
  mobile_load_app_config "$(mobile_device_address "${device}")"
  mobile_bind_device_port "${device}" "${PUBLIRA_PUBLIC_API_PORT}"
  printf 'profile %s on %s: server %s, tenant %s\n' \
    "${MOBILE_PROFILE_NAME}" "${device}" "${PUBLIRA_BASE_URL}" \
    "${PUBLIRA_TENANT_HOST}"
  require_profile_stack

  sign_in_reader
  mapfile -t defines < <(
    mobile_dart_defines "${PUBLIRA_BASE_URL}"
  )
  defines+=("${session_define}")
  mobile_generate_build_config
  app_id="$(mobile_dev_application_id)"
  flutter build apk --debug "${defines[@]}"
  adb -s "${device}" install -r "${APK}"
  activity="$(adb -s "${device}" shell cmd package resolve-activity --brief "${app_id}" | tail -1 | tr -d '\r')"

  for route in "${routes[@]}"; do
    name="$(route_name "${route}")"
    # The route reaches a launch rather than a running app, so each screen
    # starts from a process of its own: `route` is the initial route Flutter's
    # Android embedding reads off the intent, and a resumed activity would
    # keep the screen it was left on instead.
    adb -s "${device}" shell am force-stop "${app_id}"
    adb -s "${device}" shell am start -n "${activity}" --es route "${route}" > /dev/null
    for attempt in $(seq 60); do
      if adb -s "${device}" shell dumpsys window | grep -q "mCurrentFocus.*${app_id}"; then
        break
      fi
      # An app that crashes on launch never takes focus, and waiting for it
      # forever is a run with no picture and no message either.
      [[ "${attempt}" -lt 60 ]] ||
        dev_env_die "${app_id} never took focus on ${device} for route ${route}"
      sleep 1
    done
    sleep "$(awk -v milliseconds="${wait_ms}" 'BEGIN { print milliseconds / 1000 }')"
    adb -s "${device}" exec-out screencap -p > "${out_dir}/${name}.png"
    printf 'captured %s\n' "${out_dir}/${name}.png"
  done
}

# The one-origin server, while it is running. Not local to the function that
# starts it: the trap that stops it runs as the script exits, where a local of
# a function that has already returned is an unset variable.
server_pid=''

stop_web_app_server() {
  [[ -z "${server_pid}" ]] || kill "${server_pid}" 2> /dev/null || true
}

screenshot_in_browser() {
  local server_url port origin route name
  mobile_load_app_config 127.0.0.1
  server_url="${PUBLIRA_BASE_URL}"
  printf 'profile %s in a browser: server %s, tenant %s\n' \
    "${MOBILE_PROFILE_NAME}" "${server_url}" "${PUBLIRA_TENANT_HOST}"
  require_profile_stack

  # A profile owns the whole thousand its ports are numbered in, and hands them
  # out in tens: the edge takes the fiftieth, this takes the sixtieth. The
  # number is compiled into the build, which is why it is derived rather than
  # picked from whatever is free.
  port="$((PUBLIRA_WEB_HOST_PORT + 60))"
  origin="http://127.0.0.1:${port}"
  sign_in_reader
  mapfile -t defines < <(mobile_dart_defines "${origin}")
  defines+=("${session_define}")
  flutter build web "${defines[@]}"

  dart run scripts/web_app_server.dart \
    --port "${port}" --server "${server_url}" --root build/web &
  server_pid=$!
  trap stop_web_app_server EXIT
  wait4x http "${origin}/index.html" --timeout 30s

  for route in "${routes[@]}"; do
    name="$(route_name "${route}")"
    # go_router runs on Flutter's default URL strategy, which keeps the route
    # in the fragment, so the server is asked for the one page either way.
    pnpm --dir "${REPO_ROOT}/e2e" exec playwright screenshot \
      --device="${PUBLIRA_MOBILE_SCREENSHOT_DEVICE:-Pixel 7}" \
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
