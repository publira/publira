#!/usr/bin/env bash
# Start/stop only the admin-api-server process (Connect :8001, gRPC :8101).
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_API_READY_TIMEOUT_SEC:-60}"

admin_api_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_ADMIN_API_GRPC_PORT}"
}

admin_api_is_ready() {
  curl -sS --max-time 3 "$(admin_api_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_admin_api_server() {
  ensure_run_dirs

  if admin_api_is_ready; then
    e2e_log "admin-api-server already running"
    return 0
  fi

  local api_bin="${REPO_ROOT}/server/bin/admin-api-server"
  if [[ ! -x "${api_bin}" ]]; then
    e2e_err "admin-api-server binary not found at ${api_bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting admin-api-server (connect :${E2E_ADMIN_API_PORT}, grpc :${E2E_ADMIN_API_GRPC_PORT})"
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL}" \
      PUBLIRA_ADMIN_API_ADDR=":${E2E_ADMIN_API_PORT}" \
      PUBLIRA_ADMIN_API_GRPC_ADDR=":${E2E_ADMIN_API_GRPC_PORT}" \
      PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
      PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-}" \
      PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT:-}" \
      PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE:-}" \
      AWS_REGION="${AWS_REGION:-}" \
      AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
      AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}" \
      "${api_bin}"
  ) >>"${LOG_DIR}/admin-api-server.log" 2>&1 &
  write_pid "admin-api-server" $!
}

wait_admin_api_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if admin_api_is_ready; then
      e2e_log "ready: admin-api-server"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "admin-api-server did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

wait_admin_api_stopped() {
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if ! admin_api_is_ready; then
      return 0
    fi
    sleep 0.2
  done
  e2e_err "admin-api-server still answering /readyz after stop"
  exit 1
}

case "${1:-}" in
  start)
    start_admin_api_server
    ;;
  start-wait)
    start_admin_api_server
    wait_admin_api_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "admin-api-server"
    wait_admin_api_stopped
    ;;
  *)
    e2e_err "usage: admin-api-server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
