#!/usr/bin/env bash
# Start/stop only the sign-in-provider process, the stand-in for Apple's and
# Google's signing keys and for the disposable-domain list that
# sign-in-provider.ts describes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_SIGN_IN_PROVIDER_READY_TIMEOUT_SEC:-60}"

sign_in_provider_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_SIGN_IN_PROVIDER_PORT}"
}

sign_in_provider_is_ready() {
  curl -sS --max-time 3 "$(sign_in_provider_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_sign_in_provider() {
  ensure_run_dirs

  if sign_in_provider_is_ready; then
    e2e_log "sign-in-provider already running"
    return 0
  fi

  e2e_log "starting sign-in-provider (:${PUBLIRA_E2E_SIGN_IN_PROVIDER_PORT})"
  start_process_group "sign-in-provider" "${PUBLIRA_E2E_DIR}" "${LOG_DIR}/sign-in-provider.log" \
    env \
    PORT="${PUBLIRA_E2E_SIGN_IN_PROVIDER_PORT}" \
    KEY_FILE="${PUBLIRA_E2E_RUN_DIR}/sign-in-provider-key.pem" \
    node scripts/sign-in-provider.ts
}

wait_sign_in_provider_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if sign_in_provider_is_ready; then
      e2e_log "ready: sign-in-provider"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "sign-in-provider did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_sign_in_provider
    ;;
  start-wait)
    start_sign_in_provider
    wait_sign_in_provider_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "sign-in-provider"
    ;;
  *)
    e2e_err "usage: sign-in-provider.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
