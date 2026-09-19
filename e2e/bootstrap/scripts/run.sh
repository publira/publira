#!/usr/bin/env bash
# Dev-environment bootstrap check.
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

for cmd in docker task psql migrate wait4x; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    bootstrap_fail "required command not found: ${cmd}"
  fi
done

# Phase 3 restarts containers, so the wait it relies on is checked first, before
# anything is up and with `compose` stubbed.
bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/lib_test.sh"

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
  bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/down.sh" || true
}

# A signal handler that just returns would let the script resume at the next
# command — with the stack already torn down. Exit explicitly instead.
on_signal() {
  local signal="$1"
  bootstrap_err "received SIG${signal}; aborting"
  cleanup
  trap - EXIT
  exit $((128 + $(kill -l "${signal}")))
}

trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

bootstrap_log "=== bootstrap check start (project=${COMPOSE_PROJECT_NAME}) ==="

bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/setup.sh"
bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/restart-db.sh"

# Local escape hatch: the dev ports are fixed, so a running `task dev` would
# otherwise make phase 4 fail on the port preflight. Never set this in CI.
if [[ "${PUBLIRA_BOOTSTRAP_SKIP_DEV:-0}" == "1" ]]; then
  bootstrap_log "PUBLIRA_BOOTSTRAP_SKIP_DEV=1 — skipping phase 4 (task dev)"
else
  bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/dev-up.sh"
  bash "${PUBLIRA_BOOTSTRAP_SCRIPTS_DIR}/dev-wait.sh"
fi

bootstrap_log "=== bootstrap check succeeded ==="
