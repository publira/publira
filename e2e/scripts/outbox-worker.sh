#!/usr/bin/env bash
# Start/stop the outbox/River worker.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_OUTBOX_WORKER_READY_TIMEOUT_SEC:-60}"

outbox_worker_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_OUTBOX_WORKER_PORT}"
}

outbox_worker_is_ready() {
  curl -sS --max-time 3 "$(outbox_worker_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_outbox_worker() {
  ensure_run_dirs

  if outbox_worker_is_ready; then
    e2e_log "outbox-worker already running"
    return 0
  fi

  local bin="${REPO_ROOT}/server/bin/outbox-worker"
  if [[ ! -x "${bin}" ]]; then
    e2e_err "outbox-worker binary not found at ${bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting outbox-worker (addr :${E2E_OUTBOX_WORKER_PORT})"
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_DB_URL="${PUBLIRA_DB_URL}" \
      PUBLIRA_WORKER_ADDR=":${E2E_OUTBOX_WORKER_PORT}" \
      PUBLIRA_EMAIL_RENDERER_URL="${PUBLIRA_EMAIL_RENDERER_URL}" \
      PUBLIRA_PLATFORM_APP_URL="${PUBLIRA_PLATFORM_APP_URL}" \
      "${bin}"
  ) >>"${LOG_DIR}/outbox-worker.log" 2>&1 &
  write_pid "outbox-worker" $!
}

wait_outbox_worker_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if outbox_worker_is_ready; then
      e2e_log "ready: outbox-worker"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "outbox-worker did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_outbox_worker
    ;;
  start-wait)
    start_outbox_worker
    wait_outbox_worker_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "outbox-worker"
    ;;
  *)
    e2e_err "usage: outbox-worker.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
