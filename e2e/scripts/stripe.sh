#!/usr/bin/env bash
# Start/stop only the stripe process, the stand-in for Stripe's API, its hosted
# checkout page, and its webhook that stripe.ts describes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_STRIPE_READY_TIMEOUT_SEC:-60}"

stripe_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_STRIPE_PORT}"
}

stripe_is_ready() {
  curl -sS --max-time 3 "$(stripe_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_stripe() {
  ensure_run_dirs

  if stripe_is_ready; then
    e2e_log "stripe already running"
    return 0
  fi

  e2e_log "starting stripe (:${PUBLIRA_E2E_STRIPE_PORT})"
  start_process_group "stripe" "${PUBLIRA_E2E_DIR}" "${LOG_DIR}/stripe.log" \
    env \
    PUBLIRA_E2E_STRIPE_PORT="${PUBLIRA_E2E_STRIPE_PORT}" \
    node scripts/stripe.ts
}

wait_stripe_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if stripe_is_ready; then
      e2e_log "ready: stripe"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "stripe did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_stripe
    ;;
  start-wait)
    start_stripe
    wait_stripe_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "stripe"
    ;;
  *)
    e2e_err "usage: stripe.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
