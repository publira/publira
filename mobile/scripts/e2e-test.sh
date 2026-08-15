#!/usr/bin/env bash
# Run Flutter integration tests. The public API must already be listening
# when PUBLIRA_LIVE_API=true (the default for this script).
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=../../e2e/scripts/lib.sh
source "${REPO_ROOT}/e2e/scripts/lib.sh"

ART_DIR="${E2E_RUN_DIR:-${MOBILE_DIR}/.run}/artifacts"
mkdir -p "${ART_DIR}"

export PUBLIRA_LIVE_API="${PUBLIRA_LIVE_API:-true}"

if [[ -z "${PUBLIRA_API_BASE_URL:-}" ]]; then
  if adb devices 2>/dev/null | grep -q 'emulator'; then
    PUBLIRA_API_BASE_URL="http://10.0.2.2:${E2E_PUBLIC_API_PORT}"
  else
    PUBLIRA_API_BASE_URL="http://127.0.0.1:${E2E_PUBLIC_API_PORT}"
  fi
fi
export PUBLIRA_API_BASE_URL
export PUBLIRA_TENANT_HOST="${PUBLIRA_TENANT_HOST:-localhost}"

device="${MOBILE_E2E_DEVICE:-}"
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
  e2e_err "no Flutter device; start an Android emulator or set MOBILE_E2E_DEVICE"
  exit 1
fi

e2e_log "flutter test integration_test -d ${device} (API=${PUBLIRA_API_BASE_URL} live=${PUBLIRA_LIVE_API})"

collect_failure_artifacts() {
  e2e_err "collecting mobile E2E artifacts under ${ART_DIR}"
  {
    echo "=== flutter devices ==="
    (cd "${MOBILE_DIR}" && flutter devices) || true
    echo "=== adb devices ==="
    adb devices -l || true
  } >"${ART_DIR}/devices.txt" 2>&1 || true
  adb logcat -d >"${ART_DIR}/logcat.txt" 2>/dev/null || true
  adb exec-out screencap -p >"${ART_DIR}/emulator.png" 2>/dev/null || true
  adb pull /sdcard/Documents/publira-integration "${ART_DIR}/screenshots" \
    >/dev/null 2>&1 || true
}

set +e
(
  cd "${MOBILE_DIR}"
  flutter test integration_test \
    -d "${device}" \
    --reporter expanded \
    --dart-define="PUBLIRA_LIVE_API=${PUBLIRA_LIVE_API}" \
    --dart-define="PUBLIRA_API_BASE_URL=${PUBLIRA_API_BASE_URL}" \
    --dart-define="PUBLIRA_TENANT_HOST=${PUBLIRA_TENANT_HOST}"
)
status=$?
set -e

if [[ "${status}" -ne 0 ]]; then
  collect_failure_artifacts
fi
exit "${status}"
