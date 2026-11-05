#!/usr/bin/env bash
# Start/stop only the webhook-receiver process, the stand-in for the system a
# tenant runs behind a webhook endpoint that webhook-receiver.ts describes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${PUBLIRA_E2E_WEBHOOK_RECEIVER_READY_TIMEOUT_SEC:-60}"

CERT_FILE="${PUBLIRA_E2E_RUN_DIR}/webhook-receiver-cert.pem"
KEY_FILE="${PUBLIRA_E2E_RUN_DIR}/webhook-receiver-key.pem"

webhook_receiver_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${PUBLIRA_E2E_WEBHOOK_RECEIVER_PORT}"
}

webhook_receiver_is_ready() {
  curl -sS --max-time 3 "$(webhook_receiver_readyz_url)" 2> /dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_webhook_receiver() {
  ensure_run_dirs

  if webhook_receiver_is_ready; then
    e2e_log "webhook-receiver already running"
    return 0
  fi

  # The worker reads this file as its trust store when it first dials, so it is
  # written here, before the start that start-apps.sh makes after this one.
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
    -keyout "${KEY_FILE}" -out "${CERT_FILE}" -days 30 \
    -subj "/CN=publira-e2e-webhook-receiver" \
    -addext "subjectAltName=IP:127.0.0.1" 2> /dev/null

  e2e_log "starting webhook-receiver (:${PUBLIRA_E2E_WEBHOOK_RECEIVER_PORT}, https :${PUBLIRA_E2E_WEBHOOK_RECEIVER_HTTPS_PORT})"
  start_process_group "webhook-receiver" "${PUBLIRA_E2E_DIR}" "${LOG_DIR}/webhook-receiver.log" \
    env \
    PUBLIRA_E2E_WEBHOOK_RECEIVER_PORT="${PUBLIRA_E2E_WEBHOOK_RECEIVER_PORT}" \
    PUBLIRA_E2E_WEBHOOK_RECEIVER_HTTPS_PORT="${PUBLIRA_E2E_WEBHOOK_RECEIVER_HTTPS_PORT}" \
    PUBLIRA_E2E_WEBHOOK_RECEIVER_CERT_FILE="${CERT_FILE}" \
    PUBLIRA_E2E_WEBHOOK_RECEIVER_KEY_FILE="${KEY_FILE}" \
    node scripts/webhook-receiver.ts
}

wait_webhook_receiver_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if webhook_receiver_is_ready; then
      e2e_log "ready: webhook-receiver"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "webhook-receiver did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_webhook_receiver
    ;;
  start-wait)
    start_webhook_receiver
    wait_webhook_receiver_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "webhook-receiver"
    ;;
  *)
    e2e_err "usage: webhook-receiver.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
