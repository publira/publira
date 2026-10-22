#!/usr/bin/env bash
# Start/stop only the google-tag-gateway process, the stand-in for Google's tag
# gateway that google-tag-gateway.ts describes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_READY_TIMEOUT_SEC:-60}"

google_tag_gateway_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT}"
}

google_tag_gateway_is_ready() {
  curl -sS --max-time 3 "$(google_tag_gateway_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_google_tag_gateway() {
  ensure_run_dirs

  if google_tag_gateway_is_ready; then
    e2e_log "google-tag-gateway already running"
    return 0
  fi

  e2e_log "starting google-tag-gateway (:${PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT})"
  start_process_group "google-tag-gateway" "${PUBLIRA_E2E_DIR}" "${LOG_DIR}/google-tag-gateway.log" \
    env \
    PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT="${PUBLIRA_E2E_GOOGLE_TAG_GATEWAY_PORT}" \
    node scripts/google-tag-gateway.ts
}

wait_google_tag_gateway_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if google_tag_gateway_is_ready; then
      e2e_log "ready: google-tag-gateway"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "google-tag-gateway did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_google_tag_gateway
    ;;
  start-wait)
    start_google_tag_gateway
    wait_google_tag_gateway_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "google-tag-gateway"
    ;;
  *)
    e2e_err "usage: google-tag-gateway.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
