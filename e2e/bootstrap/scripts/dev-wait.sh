#!/usr/bin/env bash
# Phase 4b: wait until every service `task dev` starts listens and answers its
# health probe.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

deadline=$((SECONDS + BOOTSTRAP_DEV_TIMEOUT_SEC))

dev_is_running() {
  local pgid
  pgid="$(cat "${DEV_PGID_FILE}" 2>/dev/null || true)"
  [[ -n "${pgid}" ]] && kill -0 "-${pgid}" 2>/dev/null
}

wait_for_probe() {
  local name="$1" url="$2" kind="$3"
  local checker="check_http_json_ok"
  if [[ "${kind}" == "text" ]]; then
    checker="check_http_text_ok"
  fi

  while ((SECONDS < deadline)); do
    if "${checker}" "${url}"; then
      bootstrap_log "ready: ${name} (${url})"
      return 0
    fi
    if ! dev_is_running; then
      bootstrap_fail "task dev exited before ${name} became ready; see ${DEV_LOG}"
    fi
    sleep "${BOOTSTRAP_DEV_INTERVAL_SEC}"
  done

  bootstrap_fail "readiness failed: ${name} (${url}) — timed out after ${BOOTSTRAP_DEV_TIMEOUT_SEC}s"
}

bootstrap_log "waiting for services (budget ${BOOTSTRAP_DEV_TIMEOUT_SEC}s)"

while IFS=$'\t' read -r name url kind; do
  [[ -n "${name}" ]] || continue
  wait_for_probe "${name}" "${url}" "${kind}"
done < <(bootstrap_probes)

for port in "${BOOTSTRAP_DEV_PORTS[@]}"; do
  if ! port_in_use "${port}"; then
    bootstrap_fail "port ${port} is not listening although every probe passed"
  fi
done
bootstrap_log "ok: all ${#BOOTSTRAP_DEV_PORTS[@]} dev ports are listening"

bootstrap_log "phase 4 passed"
