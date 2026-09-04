#!/usr/bin/env bash
# Start/stop only the email-renderer process.
#
# The outbox worker renders every mail it sends through this service, so a stack
# without it delivers nothing: the worker retries until the event dead-letters.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

READY_TIMEOUT_SEC="${E2E_EMAIL_RENDERER_READY_TIMEOUT_SEC:-60}"

email_renderer_readyz_url() {
  printf 'http://127.0.0.1:%s/readyz' "${E2E_EMAIL_RENDERER_PORT}"
}

email_renderer_is_ready() {
  curl -sS --max-time 3 "$(email_renderer_readyz_url)" 2>/dev/null |
    grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

start_email_renderer() {
  ensure_run_dirs

  if email_renderer_is_ready; then
    e2e_log "email-renderer already running"
    return 0
  fi

  local app_dir="${REPO_ROOT}/apps/email-renderer"
  local entry="${app_dir}/dist/index.mjs"
  if [[ ! -f "${entry}" ]]; then
    e2e_err "email-renderer build missing (${entry}); run: pnpm build --filter @publira/email-renderer"
    exit 1
  fi

  e2e_log "starting email-renderer (:${E2E_EMAIL_RENDERER_PORT})"
  # `exec`: without it $! can name the subshell, and stopping it would leave the
  # server holding the port. Bash usually optimizes this away; do not rely on it.
  (
    cd "${app_dir}"
    exec env \
      HOST="127.0.0.1" \
      PORT="${E2E_EMAIL_RENDERER_PORT}" \
      node dist/index.mjs
  ) >>"${LOG_DIR}/email-renderer.log" 2>&1 &
  write_pid "email-renderer" $!
}

wait_email_renderer_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if email_renderer_is_ready; then
      e2e_log "ready: email-renderer"
      return 0
    fi
    sleep 0.5
  done
  e2e_err "email-renderer did not become ready within ${READY_TIMEOUT_SEC}s"
  exit 1
}

case "${1:-}" in
  start)
    start_email_renderer
    ;;
  start-wait)
    start_email_renderer
    wait_email_renderer_ready
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "email-renderer"
    ;;
  *)
    e2e_err "usage: email-renderer.sh <start|start-wait|stop>"
    exit 2
    ;;
esac
