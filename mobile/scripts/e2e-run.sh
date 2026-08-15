#!/usr/bin/env bash
# Full mobile E2E lifecycle: e2e postgres + seed + api-server + Flutter
# integration tests, always tear down.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# Must be set before lib.sh so the compose lease and E2E_RUN_DIR do not
# collide with the Playwright stack (`publira-e2e`).
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-publira-mobile-e2e}"
export E2E_RUN_DIR="${E2E_RUN_DIR:-${MOBILE_DIR}/.run}"

# shellcheck source=../../e2e/scripts/lib.sh
source "${REPO_ROOT}/e2e/scripts/lib.sh"

ensure_run_dirs
acquire_e2e_lock

cleanup_done=0
cleanup() {
  if [[ "${cleanup_done}" -eq 1 ]]; then
    return 0
  fi
  cleanup_done=1
  e2e_log "teardown (always)"
  bash "${E2E_SCRIPTS_DIR}/api-server.sh" stop || true
  bash "${E2E_SCRIPTS_DIR}/down.sh" || true
}
trap cleanup EXIT INT TERM

e2e_log "=== Mobile E2E run start (project=${COMPOSE_PROJECT_NAME}) ==="

(cd "${REPO_ROOT}" && task server:build)

bash "${E2E_SCRIPTS_DIR}/up.sh"
bash "${E2E_SCRIPTS_DIR}/db-setup.sh"
bash "${E2E_SCRIPTS_DIR}/api-server.sh" start-wait

e2e_log "=== Flutter integration_test phase ==="
set +e
bash "${MOBILE_DIR}/scripts/e2e-test.sh" "$@"
test_status=$?
set -e

if [[ "${test_status}" -ne 0 ]]; then
  e2e_err "mobile integration tests failed (exit ${test_status})"
  e2e_err "Artifacts: ${E2E_RUN_DIR}/artifacts ${LOG_DIR}"
  exit "${test_status}"
fi

e2e_log "=== Mobile E2E run succeeded ==="
