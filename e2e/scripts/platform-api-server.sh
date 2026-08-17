#!/usr/bin/env bash
# Start/stop only the platform-api-server process (Connect :8002, gRPC :8102).
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_API_READY_TIMEOUT_SEC:-60}"

platform_api_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_PLATFORM_API_GRPC_PORT}"
}

platform_api_is_ready() {
  curl -sS --max-time 3 "$(platform_api_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_platform_api_server() {
  ensure_run_dirs

  if platform_api_is_ready; then
    e2e_log "platform-api-server already running"
    return 0
  fi

  local api_bin="${REPO_ROOT}/server/bin/platform-api-server"
  if [[ ! -x "${api_bin}" ]]; then
    e2e_err "platform-api-server binary not found at ${api_bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting platform-api-server (connect :${E2E_PLATFORM_API_PORT}, grpc :${E2E_PLATFORM_API_GRPC_PORT})"
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_PLATFORM_DB_URL="${PUBLIRA_PLATFORM_DB_URL}" \
      PUBLIRA_PLATFORM_API_ADDR=":${E2E_PLATFORM_API_PORT}" \
      PUBLIRA_PLATFORM_API_GRPC_ADDR=":${E2E_PLATFORM_API_GRPC_PORT}" \
      "${api_bin}"
  ) >>"${LOG_DIR}/platform-api-server.log" 2>&1 &
  write_pid "platform-api-server" $!
}

wait_platform_api_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if platform_api_is_ready; then
      e2e_log "ready: platform-api-server"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "platform-api-server did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

wait_platform_api_stopped() {
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if ! platform_api_is_ready; then
      return 0
    fi
    sleep 0.2
  done
  e2e_err "platform-api-server still answering /readyz after stop"
  exit 1
}

case "${1:-}" in
  start)
    start_platform_api_server
    ;;
  start-wait)
    start_platform_api_server
    wait_platform_api_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "platform-api-server"
    wait_platform_api_stopped
    ;;
  *)
    e2e_err "usage: platform-api-server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
