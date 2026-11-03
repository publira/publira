#!/usr/bin/env bash
# Start/stop only the server process, the one that answers the API and the
# images on one port: `/rpc` and `/images` reach it as they are, and
# the Next.js apps dial its `/rpc` directly.
#
# start-apps.sh uses it for the normal lifecycle; the outage scenarios
# (e2e/src/server.ts) use it to take the backend down mid-run and bring it
# back, so each app's behaviour with an unreachable backend is observable. One
# process carries all three Connect namespaces and the image delivery, so
# stopping it takes the tenant and platform consoles down with the tenant site
# — which is why the specs that do it run one after another rather than beside
# each other.
#
# The binary is the one built on the host, run inside the image
# `e2e/server/Dockerfile` describes, so the libvips that converts every image a
# screenshot draws is that image's and not the host's.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_API_READY_TIMEOUT_SEC:-60}"

server_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_PUBLIC_API_PORT}"
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

  e2e_log "building the server image ${PUBLIRA_E2E_SERVER_IMAGE}"
  docker build --quiet --tag "${PUBLIRA_E2E_SERVER_IMAGE}" "${PUBLIRA_E2E_DIR}/server" > /dev/null

  # A container a killed run left behind holds the name and the port.
  remove_server_container

  # Every other setting the server reads, lib.sh has already exported.
  export PUBLIRA_PUBLIC_API_ADDR=":${PUBLIRA_E2E_PUBLIC_API_PORT}"

  # The environment a process on the host would have inherited, as far as the
  # server reads it: its own settings, the AWS SDK's, and OpenTelemetry's.
  local -a env_args=()
  local name
  while read -r name; do
    case "${name}" in
      PUBLIRA_* | AWS_* | OTEL_*) env_args+=(--env "${name}") ;;
    esac
  done < <(compgen -e)

  # Host networking, as for the edge and the browser: every address the server
  # dials is on the host's loopback, and the edge reaches it on the same port.
  # `docker run` stays in the foreground and passes SIGTERM on to the server,
  # so the process group stop_pid_file stops is the server's own.
  e2e_log "starting server (:${PUBLIRA_E2E_PUBLIC_API_PORT})"
  start_process_group "server" "${REPO_ROOT}/server" "${LOG_DIR}/server.log" \
    docker run --rm \
    --name "${PUBLIRA_E2E_SERVER_CONTAINER}" \
    --network host \
    --user "$(id -u):$(id -g)" \
    --volume "${bin}:/usr/local/bin/publira:ro" \
    "${env_args[@]}" \
    "${PUBLIRA_E2E_SERVER_IMAGE}" server
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
    remove_server_container
    wait_server_stopped
    ;;
  *)
    e2e_err "usage: server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
