#!/usr/bin/env bash
# Start/stop the background worker, which also runs the three periodic jobs
# that promote due episodes, apply free window boundaries, and roll tenant days.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_WORKER_READY_TIMEOUT_SEC:-60}"

worker_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_WORKER_PORT}"
}

worker_is_ready() {
  curl -sS --max-time 3 "$(worker_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_worker() {
  ensure_run_dirs

  if worker_is_ready; then
    e2e_log "worker already running"
    return 0
  fi

  local bin="${REPO_ROOT}/server/bin/worker"
  if [[ ! -x "${bin}" ]]; then
    e2e_err "worker binary not found at ${bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting worker (addr :${PUBLIRA_E2E_WORKER_PORT}, ticker intervals ${PUBLIRA_E2E_PUBLISH_EPISODES_INTERVAL_SEC}s/${PUBLIRA_E2E_FREE_WINDOW_INTERVAL_SEC}s/${PUBLIRA_E2E_TENANT_DAY_INTERVAL_SEC}s)"
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_WORKER_DB_URL="${PUBLIRA_WORKER_DB_URL}" \
      PUBLIRA_TICKER_DB_URL="${PUBLIRA_TICKER_DB_URL}" \
      PUBLIRA_WORKER_ADDR=":${PUBLIRA_E2E_WORKER_PORT}" \
      PUBLIRA_EMAIL_RENDERER_URL="${PUBLIRA_EMAIL_RENDERER_URL}" \
      PUBLIRA_PLATFORM_APP_URL="${PUBLIRA_PLATFORM_APP_URL}" \
      PUBLIRA_SECRET_ENCRYPTION_KEYS="${PUBLIRA_SECRET_ENCRYPTION_KEYS}" \
      PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID="${PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID}" \
      PUBLIRA_WEBPUSH_VAPID_PUBLIC_KEY="${PUBLIRA_WEBPUSH_VAPID_PUBLIC_KEY:-}" \
      PUBLIRA_WEBPUSH_VAPID_PRIVATE_KEY="${PUBLIRA_WEBPUSH_VAPID_PRIVATE_KEY:-}" \
      PUBLIRA_WEBPUSH_SUBJECT="${PUBLIRA_WEBPUSH_SUBJECT:-}" \
      PUBLIRA_PUBLISH_INTERVAL_SECONDS="${PUBLIRA_E2E_PUBLISH_EPISODES_INTERVAL_SEC}" \
      PUBLIRA_FREE_WINDOW_INTERVAL_SECONDS="${PUBLIRA_E2E_FREE_WINDOW_INTERVAL_SEC}" \
      PUBLIRA_TENANT_DAY_INTERVAL_SECONDS="${PUBLIRA_E2E_TENANT_DAY_INTERVAL_SEC}" \
      PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
      PUBLIRA_WEB_HOST_INTERNAL_URL="${PUBLIRA_WEB_HOST_INTERNAL_URL}" \
      PUBLIRA_WEB_ADMIN_INTERNAL_URL="${PUBLIRA_WEB_ADMIN_INTERNAL_URL}" \
      PUBLIRA_WEB_PLATFORM_INTERNAL_URL="${PUBLIRA_WEB_PLATFORM_INTERNAL_URL}" \
      "${bin}"
  ) >> "${LOG_DIR}/worker.log" 2>&1 &
  write_pid "worker" $!
}

wait_worker_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if worker_is_ready; then
      e2e_log "ready: worker"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "worker did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_worker
    ;;
  start-wait)
    start_worker
    wait_worker_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "worker"
    ;;
  *)
    e2e_err "usage: worker.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
