#!/usr/bin/env bash
# Start/stop only the api-server process.
#
# start-apps.sh uses it for the normal lifecycle; the outage scenario
# (e2e/src/api-server.ts) uses it to take the public API down mid-run and bring
# it back, so web-host's behaviour with an unreachable backend is observable.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_API_READY_TIMEOUT_SEC:-60}"

api_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_PUBLIC_API_GRPC_PORT}"
}

api_is_ready() {
  curl -sS --max-time 3 "$(api_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_api_server() {
  ensure_run_dirs

  # Idempotent: the outage scenario may restore the server before its afterAll.
  if api_is_ready; then
    e2e_log "api-server already running"
    return 0
  fi

  local api_bin="${REPO_ROOT}/server/bin/api-server"
  if [[ ! -x "${api_bin}" ]]; then
    e2e_err "api-server binary not found at ${api_bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting api-server (connect :${E2E_PUBLIC_API_PORT}, grpc :${E2E_PUBLIC_API_GRPC_PORT})"
  # `exec`: without it $! can name the subshell, and stopping it would leave the
  # server holding the port. Bash usually optimizes this away; do not rely on it.
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL}" \
      PUBLIRA_PUBLIC_API_ADDR=":${E2E_PUBLIC_API_PORT}" \
      PUBLIRA_PUBLIC_API_GRPC_ADDR=":${E2E_PUBLIC_API_GRPC_PORT}" \
      PUBLIRA_STORAGE_BACKEND="${PUBLIRA_STORAGE_BACKEND}" \
      PUBLIRA_LOCAL_STORAGE_DIR="${PUBLIRA_LOCAL_STORAGE_DIR}" \
      PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-}" \
      PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT:-}" \
      PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE:-}" \
      AWS_REGION="${AWS_REGION:-}" \
      AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
      AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}" \
      "${api_bin}"
  ) >>"${LOG_DIR}/api-server.log" 2>&1 &
  write_pid "api-server" $!
}

wait_api_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if api_is_ready; then
      e2e_log "ready: api-server"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "api-server did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

wait_api_stopped() {
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if ! api_is_ready; then
      return 0
    fi
    sleep 0.2
  done
  e2e_err "api-server still answering /readyz after stop"
  exit 1
}

case "${1:-}" in
  start)
    start_api_server
    ;;
  start-wait)
    start_api_server
    wait_api_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "api-server"
    wait_api_stopped
    ;;
  *)
    e2e_err "usage: api-server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
