#!/usr/bin/env bash
# Start/stop only the server process, the one that answers the API and the
# images: `/api` and `/images` reach its edge listener as they are, and the
# Next.js apps dial its internal listener.
#
# start-apps.sh uses it for the normal lifecycle; the outage scenarios
# (e2e/src/server.ts) use it to take the backend down mid-run and bring it
# back, so each app's behaviour with an unreachable backend is observable. One
# process carries all three Connect namespaces and the image delivery, so
# stopping it takes the tenant and platform consoles down with the tenant site
# — which is why the specs that do it run one after another rather than beside
# each other.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_API_READY_TIMEOUT_SEC:-60}"

server_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}"
}

server_is_ready() {
  curl -sS --max-time 3 "$(server_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_server() {
  ensure_run_dirs

  # Idempotent: the outage scenario may restore the server before its afterAll.
  if server_is_ready; then
    e2e_log "server already running"
    return 0
  fi

  local bin="${REPO_ROOT}/server/bin/publira"
  if [[ ! -x "${bin}" ]]; then
    e2e_err "publira binary not found at ${bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting server (edge :${PUBLIRA_E2E_PUBLIC_API_PORT}, internal :${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT})"
  # `exec`: without it $! can name the subshell, and stopping it would leave the
  # server holding the port. Bash usually optimizes this away; do not rely on it.
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL}" \
      PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL}" \
      PUBLIRA_PLATFORM_DB_URL="${PUBLIRA_PLATFORM_DB_URL}" \
      PUBLIRA_PUBLIC_API_ADDR=":${PUBLIRA_E2E_PUBLIC_API_PORT}" \
      PUBLIRA_PUBLIC_API_GRPC_ADDR=":${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}" \
      PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
      PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" \
      PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN:-}" \
      PUBLIRA_WEB_HOST_INTERNAL_URL="${PUBLIRA_WEB_HOST_INTERNAL_URL:-}" \
      PUBLIRA_WEB_ADMIN_INTERNAL_URL="${PUBLIRA_WEB_ADMIN_INTERNAL_URL:-}" \
      PUBLIRA_WEB_PLATFORM_INTERNAL_URL="${PUBLIRA_WEB_PLATFORM_INTERNAL_URL:-}" \
      AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
      AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}" \
      "${bin}" server
  ) >> "${LOG_DIR}/server.log" 2>&1 &
  write_pid "server" $!
}

wait_server_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if server_is_ready; then
      e2e_log "ready: server"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "server did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

wait_server_stopped() {
  local deadline=$((SECONDS + 30))
  while ((SECONDS < deadline)); do
    if ! server_is_ready; then
      return 0
    fi
    sleep 0.2
  done
  e2e_err "server still answering /readyz after stop"
  exit 1
}

case "${1:-}" in
  start)
    start_server
    ;;
  start-wait)
    start_server
    wait_server_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "server"
    wait_server_stopped
    ;;
  *)
    e2e_err "usage: server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
