#!/usr/bin/env bash
# Start/stop only the paidy process, the stand-in for Paidy's API and Paidy
# Checkout that paidy.ts describes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_PAIDY_READY_TIMEOUT_SEC:-60}"

paidy_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_PAIDY_PORT}"
}

paidy_is_ready() {
  curl -sS --max-time 3 "$(paidy_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_paidy() {
  ensure_run_dirs

  if paidy_is_ready; then
    e2e_log "paidy already running"
    return 0
  fi

  e2e_log "starting paidy (:${PUBLIRA_E2E_PAIDY_PORT})"
  start_process_group "paidy" "${PUBLIRA_E2E_DIR}" "${LOG_DIR}/paidy.log" \
    env \
    PUBLIRA_E2E_PAIDY_PORT="${PUBLIRA_E2E_PAIDY_PORT}" \
    node scripts/paidy.ts
}

wait_paidy_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if paidy_is_ready; then
      e2e_log "ready: paidy"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "paidy did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_paidy
    ;;
  start-wait)
    start_paidy
    wait_paidy_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "paidy"
    ;;
  *)
    e2e_err "usage: paidy.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
