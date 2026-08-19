#!/usr/bin/env bash
# Phase 4b: wait until every service `task dev` starts listens and answers its
# health probe.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Matches the previous grep for `"status": "ok"` (optional spaces around `:`).
JSON_OK_REGEX='"status"[[:space:]]*:[[:space:]]*"ok"'
# Whole-body `ok`, matching the previous check_http_text_ok (exact line).
LIVEZ_REGEX='^[[:space:]]*ok[[:space:]]*$'

if ! command -v wait4x >/dev/null 2>&1; then
  bootstrap_fail "required command not found: wait4x"
fi

dev_is_running() {
  local pgid
  pgid="$(cat "${DEV_PGID_FILE}" 2>/dev/null || true)"
  [[ -n "${pgid}" ]] && kill -0 "-${pgid}" 2>/dev/null
}

# wait4x cannot abort when `task dev` dies mid-wait (that would need a second
# poll loop). After it returns, distinguish "process gone" from "probe still
# failing" so the error matches the previous wait_for_probe messages.
fail_probe() {
  local name="$1" url="$2"
  if ! dev_is_running; then
    bootstrap_fail "task dev exited before ${name} became ready; see ${DEV_LOG}"
  fi
  bootstrap_fail "readiness failed: ${name} (${url}) — timed out after ${BOOTSTRAP_DEV_TIMEOUT_SEC}s"
}

wait_http_probe() {
  local name="$1" url="$2" kind="$3"
  local remaining=$((BOOTSTRAP_DEV_TIMEOUT_SEC - SECONDS))
  local body_regex="${JSON_OK_REGEX}"

  # Shared budget across probes, same as the previous deadline. wait4x --timeout
  # 0 is unlimited, so treat a spent budget as a failure before invoking it.
  if ((remaining <= 0)); then
    fail_probe "${name}" "${url}"
  fi
  if [[ "${kind}" == "text" ]]; then
    body_regex="${LIVEZ_REGEX}"
  fi

  if wait4x http "${url}" \
    --timeout "${remaining}s" \
    --interval "${BOOTSTRAP_DEV_INTERVAL_SEC}s" \
    --connection-timeout 5s \
    --quiet \
    --no-color \
    --expect-status-code 200 \
    --expect-body-regex "${body_regex}"; then
    bootstrap_log "ready: ${name} (${url})"
    return 0
  fi
  fail_probe "${name}" "${url}"
}

bootstrap_log "waiting for services (budget ${BOOTSTRAP_DEV_TIMEOUT_SEC}s)"

while IFS=$'\t' read -r name url kind; do
  [[ -n "${name}" ]] || continue
  wait_http_probe "${name}" "${url}" "${kind}"
done < <(bootstrap_probes)

for port in "${BOOTSTRAP_DEV_PORTS[@]}"; do
  if ! port_in_use "${port}"; then
    bootstrap_fail "port ${port} is not listening although every probe passed"
  fi
done
bootstrap_log "ok: all ${#BOOTSTRAP_DEV_PORTS[@]} dev ports are listening"

# A green /readyz only proves the apps reached *some* Redis. If
# PUBLIRA_REDIS_URL never reaches them they fall back to redis://localhost:6379,
# which may well be another live instance — so require clients on the bootstrap
# Redis itself.
# `connected_clients` counts the redis-cli issuing this query, hence >= 2.
clients="$(redis_connected_clients)"
if [[ -z "${clients}" ]] || ((clients < 2)); then
  bootstrap_fail "no app is connected to the bootstrap Redis (connected_clients=${clients:-unknown}); PUBLIRA_REDIS_URL is probably not reaching the dev tasks"
fi
bootstrap_log "ok: bootstrap Redis has ${clients} connected clients"

bootstrap_log "phase 4 passed"
