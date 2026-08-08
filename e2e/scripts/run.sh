#!/usr/bin/env bash
# Full E2E lifecycle: up → db → start apps → wait-ready → playwright → down.
# Distinguishes readiness failure (before Playwright) from test failure.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

cleanup_done=0
cleanup() {
  if [[ "${cleanup_done}" -eq 1 ]]; then
    return 0
  fi
  cleanup_done=1
  e2e_log "teardown (always)"
  bash "${E2E_SCRIPTS_DIR}/down.sh" || true
}
trap cleanup EXIT INT TERM

e2e_log "=== E2E run start (project=${COMPOSE_PROJECT_NAME}) ==="

bash "${E2E_SCRIPTS_DIR}/up.sh"
bash "${E2E_SCRIPTS_DIR}/db-setup.sh"
bash "${E2E_SCRIPTS_DIR}/start-apps.sh"

# Readiness phase — on failure exit before Playwright (message: "readiness failed:")
bash "${E2E_SCRIPTS_DIR}/wait-ready.sh"

e2e_log "=== Playwright phase ==="
set +e
(
  cd "${E2E_DIR}"
  # Re-export so Playwright config/fixtures see the same URLs.
  export E2E_WEB_HOST_BASE_URL PUBLIRA_DB_URL E2E_PUBLIC_API_BASE_URL
  pnpm exec playwright test "$@"
)
test_status=$?
set -e

if [[ "${test_status}" -ne 0 ]]; then
  e2e_err "Playwright tests failed (exit ${test_status})"
  e2e_err "Artifacts: ${E2E_DIR}/test-results ${E2E_DIR}/playwright-report ${LOG_DIR}"
  exit "${test_status}"
fi

e2e_log "=== E2E run succeeded ==="
