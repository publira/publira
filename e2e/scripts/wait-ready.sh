#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Per-probe budget. compose --wait (up.sh) already covered postgres / redis /
# rustfs container healthchecks; this script only probes host-reachable HTTP.
TIMEOUT_SEC="${E2E_READY_TIMEOUT_SEC:-90}"
INTERVAL_SEC="${E2E_READY_INTERVAL_SEC:-1}"

# Matches the previous grep for `"status": "ok"` (optional spaces around `:`).
JSON_OK_REGEX='"status"[[:space:]]*:[[:space:]]*"ok"'

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

require_wait4x() {
  if command -v wait4x >/dev/null 2>&1; then
    return 0
  fi
  e2e_err "wait4x is not installed (needed to wait for HTTP readiness probes)"
  exit 1
}

# wait4x owns the poll, interval, and deadline. This only names the probe so
# fail_readiness can keep the previous diagnostics.
wait_http() {
  local name="$1"
  local url="$2"
  shift 2
  if wait4x http "${url}" \
    --timeout "${TIMEOUT_SEC}s" \
    --interval "${INTERVAL_SEC}s" \
    --connection-timeout 3s \
    --quiet \
    --no-color \
    --expect-status-code 200 \
    "$@"; then
    e2e_log "ready: ${name}"
    return 0
  fi
  fail_readiness "${name}" "timed out after ${TIMEOUT_SEC}s"
}

require_wait4x
e2e_log "waiting for readiness (timeout ${TIMEOUT_SEC}s)"

# Checked from the host (not the compose healthcheck): the API servers reach
# RustFS through the published port, so a container-only probe would miss it.
wait_http "rustfs" "http://127.0.0.1:${E2E_RUSTFS_PORT}/health"

wait_http "public-api/readyz" \
  "http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

wait_http "admin-api/readyz" \
  "http://127.0.0.1:${E2E_ADMIN_API_GRPC_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

wait_http "platform-api/readyz" \
  "http://127.0.0.1:${E2E_PLATFORM_API_GRPC_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

wait_http "email-renderer/readyz" \
  "http://127.0.0.1:${E2E_EMAIL_RENDERER_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

wait_http "outbox-worker/readyz" \
  "http://127.0.0.1:${E2E_OUTBOX_WORKER_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

wait_http "image-server/readyz" \
  "http://127.0.0.1:${E2E_IMAGE_SERVER_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

# Use localhost (not 127.0.0.1) to match browser Host / server bind hostname.
# Substring `ok`, matching the previous check_http_body.
wait_http "web-host/livez" \
  "http://localhost:${E2E_WEB_HOST_PORT}/livez" \
  --expect-body-regex "ok"

wait_http "web-host/readyz" \
  "http://localhost:${E2E_WEB_HOST_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

# web-admin binds 0.0.0.0; probe via 127.0.0.1 (tenant resolution is skipped
# for /livez and /readyz in proxy.ts).
wait_http "web-admin/livez" \
  "http://127.0.0.1:${E2E_WEB_ADMIN_PORT}/livez" \
  --expect-body-regex "ok"

wait_http "web-admin/readyz" \
  "http://127.0.0.1:${E2E_WEB_ADMIN_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

# web-platform also binds 0.0.0.0; probes skip setup / session checks.
wait_http "web-platform/livez" \
  "http://127.0.0.1:${E2E_WEB_PLATFORM_PORT}/livez" \
  --expect-body-regex "ok"

wait_http "web-platform/readyz" \
  "http://127.0.0.1:${E2E_WEB_PLATFORM_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

# The edge itself, last: it only answers once both of its backends do. The
# viewer performance suite reads pages through this origin.
wait_http "edge/web-host/readyz" \
  "http://localhost:${E2E_EDGE_PORT}/readyz" \
  --expect-body-regex "${JSON_OK_REGEX}"

e2e_log "all readiness checks passed"
