#!/usr/bin/env bash
# Start/stop only the image-server process.
#
# It serves the episode body images the canvas viewer fetches, so the viewer
# performance suite (e2e/tests/host.viewer-performance.spec.ts) cannot measure
# anything without it. Traefik puts it on the web-host origin under `/images`.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_IMAGE_READY_TIMEOUT_SEC:-60}"

image_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_IMAGE_SERVER_PORT}"
}

image_is_ready() {
  curl -sS --max-time 3 "$(image_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_image_server() {
  ensure_run_dirs

  if image_is_ready; then
    e2e_log "image-server already running"
    return 0
  fi

  local image_bin="${REPO_ROOT}/server/bin/image-server"
  if [[ ! -x "${image_bin}" ]]; then
    e2e_err "image-server binary not found at ${image_bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting image-server (:${E2E_IMAGE_SERVER_PORT})"
  # `exec`: without it $! can name the subshell, and stopping it would leave the
  # server holding the port. Bash usually optimizes this away; do not rely on it.
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL}" \
      PUBLIRA_IMAGE_SERVER_ADDR=":${E2E_IMAGE_SERVER_PORT}" \
      PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET}" \
      PUBLIRA_REDIS_URL="${PUBLIRA_REDIS_URL}" \
      PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-}" \
      PUBLIRA_S3_ENDPOINT="${PUBLIRA_S3_ENDPOINT:-}" \
      PUBLIRA_S3_FORCE_PATH_STYLE="${PUBLIRA_S3_FORCE_PATH_STYLE:-}" \
      AWS_REGION="${AWS_REGION:-}" \
      AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}" \
      AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}" \
      "${image_bin}"
  ) >>"${LOG_DIR}/image-server.log" 2>&1 &
  write_pid "image-server" $!
}

wait_image_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if image_is_ready; then
      e2e_log "ready: image-server"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "image-server did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_image_server
    ;;
  start-wait)
    start_image_server
    wait_image_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "image-server"
    ;;
  *)
    e2e_err "usage: image-server.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
