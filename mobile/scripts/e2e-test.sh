#!/usr/bin/env bash
# Run Flutter integration tests. The public API must already be listening
# when PUBLIRA_LIVE_API=true (the default for this script).
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=../../e2e/scripts/lib.sh
source "${REPO_ROOT}/e2e/scripts/lib.sh"

ART_DIR="${PUBLIRA_E2E_RUN_DIR:-${MOBILE_DIR}/.run}/artifacts"
mkdir -p "${ART_DIR}"

export PUBLIRA_LIVE_API="${PUBLIRA_LIVE_API:-true}"

device="${PUBLIRA_E2E_MOBILE_DEVICE:-}"
if [[ -z "${device}" ]]; then
  device="$(
    cd "${MOBILE_DIR}" && flutter devices --machine |
      python3 -c '
import json, sys
devices = json.load(sys.stdin)
for device in devices:
    target = device.get("id") or ""
    if device.get("isSupported") and target:
        print(target)
        break
'
  )"
fi
if [[ -z "${device}" ]]; then
  e2e_err "no Flutter device; start an Android emulator or set PUBLIRA_E2E_MOBILE_DEVICE"
  exit 1
fi

# `10.0.2.2` is the host as an emulator sees it; loopback there is the emulator
# itself. The device the tests run on decides, not whatever else adb lists.
case "${device}" in
  emulator-*) host_address="10.0.2.2" ;;
  *) host_address="127.0.0.1" ;;
esac
export PUBLIRA_BASE_URL="${PUBLIRA_BASE_URL:-http://${host_address}:${PUBLIRA_E2E_PUBLIC_API_PORT}}"
export PUBLIRA_TENANT_HOST="${PUBLIRA_TENANT_HOST:-localhost}"

# Whether the device gets an HTTP answer from the API port on the host.
device_reaches_api() {
  adb -s "${device}" shell \
    "printf 'GET / HTTP/1.0\r\n\r\n' | nc -w 3 ${host_address} ${PUBLIRA_E2E_PUBLIC_API_PORT}" \
    2> /dev/null | head -n 1 | grep -q '^HTTP/'
}

# An emulator's Wi-Fi can come up with an address but without the default
# route and DNS server its DHCP lease should carry, and stays that way for the
# whole run. Reconnecting asks for a fresh lease. A device that still cannot
# reach the API is left to the live group, which fails once saying so.
ensure_emulator_reaches_api() {
  local attempt waited
  for attempt in 1 2 3; do
    for ((waited = 0; waited < 20; waited++)); do
      if device_reaches_api; then
        return 0
      fi
      sleep 1
    done
    e2e_err "${device} cannot reach ${host_address}:${PUBLIRA_E2E_PUBLIC_API_PORT}; reconnecting its Wi-Fi (attempt ${attempt})"
    adb -s "${device}" shell ip route show table all > "${ART_DIR}/network-before-reconnect-${attempt}.txt" 2>&1 || true
    adb -s "${device}" shell svc wifi disable || true
    sleep 2
    adb -s "${device}" shell svc wifi enable || true
  done
  device_reaches_api && return 0
  e2e_err "${device} still cannot reach ${host_address}:${PUBLIRA_E2E_PUBLIC_API_PORT}"
}

if [[ "${PUBLIRA_LIVE_API}" == 'true' && "${device}" == emulator-* ]]; then
  ensure_emulator_reaches_api
fi

e2e_log "flutter test integration_test -d ${device} (server=${PUBLIRA_BASE_URL} live=${PUBLIRA_LIVE_API})"

collect_failure_artifacts() {
  e2e_err "collecting mobile E2E artifacts under ${ART_DIR}"
  {
    echo "=== flutter devices ==="
    (cd "${MOBILE_DIR}" && flutter devices) || true
    echo "=== adb devices ==="
    adb devices -l || true
  } > "${ART_DIR}/devices.txt" 2>&1 || true
  adb -s "${device}" logcat -d > "${ART_DIR}/logcat.txt" 2> /dev/null || true
  adb -s "${device}" exec-out screencap -p > "${ART_DIR}/emulator.png" 2> /dev/null || true
  adb -s "${device}" pull /sdcard/Documents/publira-integration "${ART_DIR}/screenshots" \
    > /dev/null 2>&1 || true
  # The device only sees that its reads failed. The same read from the host
  # tells a stopped server or a missing seed tenant from a device with no way
  # out, and the device's own view says whether its network ever validated.
  {
    echo "=== GetTenantByDomain from the host ==="
    curl -sS --max-time 10 \
      -H 'content-type: application/json' \
      -H 'connect-protocol-version: 1' \
      --data "{\"domains\":[\"${PUBLIRA_TENANT_HOST}\"]}" \
      "http://127.0.0.1:${PUBLIRA_E2E_PUBLIC_API_PORT}/api/publira.v1.DomainService/GetTenantByDomain" || true
    echo
    echo "=== ping ${host_address} from the device ==="
    adb -s "${device}" shell ping -c 3 -W 2 "${host_address}" || true
    echo "=== routes on the device ==="
    adb -s "${device}" shell ip route show table all || true
    echo "=== dumpsys connectivity ==="
    adb -s "${device}" shell dumpsys connectivity || true
  } > "${ART_DIR}/network.txt" 2>&1 || true
}

# Publira's own identity, whatever another manifest generated before.
(cd "${MOBILE_DIR}" && dart run scripts/app_manifest.dart --generate)

set +e
(
  cd "${MOBILE_DIR}"
  flutter test integration_test \
    -d "${device}" \
    --reporter expanded \
    --dart-define="PUBLIRA_LIVE_API=${PUBLIRA_LIVE_API}" \
    --dart-define="PUBLIRA_BASE_URL=${PUBLIRA_BASE_URL}" \
    --dart-define="PUBLIRA_TENANT_HOST=${PUBLIRA_TENANT_HOST}"
)
status=$?
set -e

if [[ "${status}" -ne 0 ]]; then
  collect_failure_artifacts
fi
exit "${status}"
