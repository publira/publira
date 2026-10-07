#!/usr/bin/env bash
# Edge routing check for one proxy.
#
#   up → wait for the edge to serve → probe hosts / /api / /images
#   → up again with no platform hosts → wait → probe what that leaves → down
#
# Always tears down (success, failure, or interrupt) and collects Compose
# output — and, for Traefik, its API — into e2e/routing/.run/<proxy>/logs when
# the run fails.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
acquire_routing_lock

for cmd in docker curl; do
  if ! command -v "${cmd}" > /dev/null 2>&1; then
    routing_fail "required command not found: ${cmd}"
  fi
done

cleanup_done=0
cleanup() {
  local status="${1:-$?}"
  if [[ "${cleanup_done}" -eq 1 ]]; then
    return
  fi
  cleanup_done=1
  if [[ "${status}" -ne 0 ]]; then
    collect_diagnostics
  fi
  # Preserve the probe/signal status even if teardown itself fails.
  bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/down.sh" ||
    routing_err "teardown failed (exit $?); compose project ${COMPOSE_PROJECT_NAME} may still be up"
}

on_signal() {
  local signal="$1"
  local status=$((128 + $(kill -l "${signal}")))
  routing_err "received SIG${signal}; aborting"
  cleanup "${status}"
  trap - EXIT
  exit "${status}"
}

trap cleanup EXIT
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM

routing_log "=== routing check start (project=${COMPOSE_PROJECT_NAME}) ==="

bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test.sh"

# An install that runs no web-platform leaves its list empty and removes
# nothing from the sample, so the same files have to start with an empty list
# and still route the other two apps.
export PUBLIRA_ROUTING_PLATFORM_HOSTS=""
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/up.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/wait-ready.sh"
bash "${PUBLIRA_ROUTING_SCRIPTS_DIR}/test-without-platform.sh"

routing_log "=== routing check succeeded ==="
