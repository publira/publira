#!/usr/bin/env bash
# Dev-environment bootstrap check (#514).
#
#   phase 1  fresh Compose project + empty Postgres volume
#   phase 2  task setup → migrations clean, dev seed applied and re-runnable
#   phase 3  db restart → migration state and seed data persist
#   phase 4  task dev → every API / gRPC / image / Next.js service ready
#
# Always tears down (success, failure, or interrupt) and collects Compose and
# application logs into e2e/bootstrap/.run/logs when the run fails.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

for cmd in docker task psql migrate; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    bootstrap_fail "required command not found: ${cmd}"
  fi
done

cleanup_done=0
cleanup() {
  local status=$?
  if [[ "${cleanup_done}" -eq 1 ]]; then
    return
  fi
  cleanup_done=1
  if [[ "${status}" -ne 0 ]]; then
    collect_diagnostics
  fi
  bash "${BOOTSTRAP_SCRIPTS_DIR}/down.sh" || true
}
trap cleanup EXIT INT TERM

bootstrap_log "=== bootstrap check start (project=${COMPOSE_PROJECT_NAME}) ==="

bash "${BOOTSTRAP_SCRIPTS_DIR}/up.sh"
bash "${BOOTSTRAP_SCRIPTS_DIR}/setup.sh"
bash "${BOOTSTRAP_SCRIPTS_DIR}/restart-db.sh"

# Local escape hatch: the dev ports are fixed, so a running `task dev` would
# otherwise make phase 4 fail on the port preflight. Never set this in CI.
if [[ "${BOOTSTRAP_SKIP_DEV:-0}" == "1" ]]; then
  bootstrap_log "BOOTSTRAP_SKIP_DEV=1 — skipping phase 4 (task dev)"
else
  bash "${BOOTSTRAP_SCRIPTS_DIR}/dev-up.sh"
  bash "${BOOTSTRAP_SCRIPTS_DIR}/dev-wait.sh"
fi

bootstrap_log "=== bootstrap check succeeded ==="
