#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

TIMEOUT_SEC="${E2E_READY_TIMEOUT_SEC:-90}"
INTERVAL_SEC="${E2E_READY_INTERVAL_SEC:-1}"

fail_readiness() {
  local name="$1"
  local detail="${2:-}"
  e2e_err "readiness failed: ${name}${detail:+ — ${detail}}"
  e2e_err "Playwright was not started. Inspect compose status and ${LOG_DIR}/*.log"
  if [[ -d "${LOG_DIR}" ]]; then
    for f in "${LOG_DIR}"/*.log; do
      [[ -f "${f}" ]] || continue
      e2e_err "--- tail $(basename "${f}") ---"
      tail -n 40 "${f}" >&2 || true
    done
  fi
  exit 1
}

wait_until() {
  local name="$1"
  shift
  local deadline=$((SECONDS + TIMEOUT_SEC))
  while ((SECONDS < deadline)); do
    if "$@"; then
      e2e_log "ready: ${name}"
      return 0
    fi
    sleep "${INTERVAL_SEC}"
  done
  fail_readiness "${name}" "timed out after ${TIMEOUT_SEC}s"
}

check_pg_isready() {
  local id
  id="$(compose ps -q postgres 2>/dev/null || true)"
  [[ -n "${id}" ]] || return 1
  docker exec "${id}" pg_isready -U postgres -d publira >/dev/null 2>&1
}

check_redis_ping() {
  local id
  id="$(compose ps -q redis 2>/dev/null || true)"
  [[ -n "${id}" ]] || return 1
  docker exec "${id}" redis-cli ping 2>/dev/null | grep -qx PONG
}

check_http_body() {
  local url="$1"
  local expect="$2"
  local code body
  code="$(curl -sS -o /tmp/e2e-ready-body -w '%{http_code}' --max-time 3 "${url}" 2>/dev/null || true)"
  body="$(cat /tmp/e2e-ready-body 2>/dev/null || true)"
  [[ "${code}" == "200" && "${body}" == *"${expect}"* ]]
}

check_http_json_ok() {
  local url="$1"
  local code body
  code="$(curl -sS -o /tmp/e2e-ready-body -w '%{http_code}' --max-time 3 "${url}" 2>/dev/null || true)"
  body="$(cat /tmp/e2e-ready-body 2>/dev/null || true)"
  [[ "${code}" == "200" ]] || return 1
  printf '%s' "${body}" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'
}

e2e_log "waiting for readiness (timeout ${TIMEOUT_SEC}s)"

wait_until "postgres" check_pg_isready
wait_until "redis" check_redis_ping

wait_until "public-api/readyz" check_http_json_ok \
  "http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}/readyz"

# Use localhost (not 127.0.0.1) to match browser Host / server bind hostname.
wait_until "web-host/livez" check_http_body \
  "http://localhost:${E2E_WEB_HOST_PORT}/livez" "ok"

wait_until "web-host/readyz" check_http_json_ok \
  "http://localhost:${E2E_WEB_HOST_PORT}/readyz"

e2e_log "all readiness checks passed"
