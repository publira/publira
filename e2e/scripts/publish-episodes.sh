#!/usr/bin/env bash
# Start/stop the publish-episodes worker (promotes scheduled listings to published).
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

start_publish_episodes() {
  ensure_run_dirs

  if [[ -f "${PID_DIR}/publish-episodes.pid" ]]; then
    local existing
    existing="$(read_pid publish-episodes || true)"
    if is_pid_running "${existing}"; then
      e2e_log "publish-episodes already running"
      return 0
    fi
  fi

  local bin="${REPO_ROOT}/server/bin/batch"
  if [[ ! -x "${bin}" ]]; then
    e2e_err "batch binary not found at ${bin}; run: task server:build"
    exit 1
  fi

  e2e_log "starting publish-episodes (interval ${E2E_PUBLISH_EPISODES_INTERVAL_SEC}s)"
  (
    cd "${REPO_ROOT}/server"
    exec env \
      PUBLIRA_DB_URL="${PUBLIRA_DB_URL}" \
      PUBLIRA_PUBLISH_INTERVAL_SECONDS="${E2E_PUBLISH_EPISODES_INTERVAL_SEC}" \
      PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN}" \
      PUBLIRA_WEB_HOST_INTERNAL_URL="${PUBLIRA_WEB_HOST_INTERNAL_URL}" \
      PUBLIRA_WEB_ADMIN_INTERNAL_URL="${PUBLIRA_WEB_ADMIN_INTERNAL_URL}" \
      PUBLIRA_WEB_PLATFORM_INTERNAL_URL="${PUBLIRA_WEB_PLATFORM_INTERNAL_URL}" \
      "${bin}" publish-episodes
  ) >>"${LOG_DIR}/publish-episodes.log" 2>&1 &
  write_pid "publish-episodes" $!
}

case "${1:-}" in
  start)
    start_publish_episodes
    ;;
  stop)
    ensure_run_dirs
    stop_pid_file "publish-episodes"
    ;;
  *)
    e2e_err "usage: publish-episodes.sh <start|stop>"
    exit 2
    ;;
esac
