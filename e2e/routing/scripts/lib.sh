#!/usr/bin/env bash
# Shared helpers for the Dev Container Traefik routing check (#55).
#
# The check overlays compose.yaml + .devcontainer/compose.yaml, keeps the real
# Traefik labels on `app`, and replaces the process behind those ports with
# echo.py so each probe can assert the backend and the path Traefik forwarded.
# shellcheck shell=bash

set -euo pipefail

ROUTING_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTING_DIR="$(cd "${ROUTING_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ROUTING_DIR}/../.." && pwd)"

# Capture before defaults so we can tell "caller set ROUTING_RUN_DIR" from unset.
_ROUTING_RUN_DIR_FROM_ENV="${ROUTING_RUN_DIR-}"

# Dedicated project name: a run never touches the Dev Container stack.
export COMPOSE_PROJECT_NAME="${ROUTING_PROJECT_NAME:-publira-routing}"
# The Dev Container file is an overlay: on its own it leaves the dependency
# services with nothing but `ports: !reset []`, which is not a valid project.
ROOT_COMPOSE_FILE="${REPO_ROOT}/compose.yaml"
DEVCONTAINER_COMPOSE_FILE="${REPO_ROOT}/.devcontainer/compose.yaml"
ROUTING_COMPOSE_FILE="${ROUTING_DIR}/compose.override.yaml"

# Absolute: the overlay's first `-f` is the root compose.yaml, so a relative
# volume would resolve against the repository root, not this directory.
export ROUTING_ECHO_PY="${ROUTING_DIR}/echo.py"

# Host ports published by compose.override.yaml. Offset from the Dev Container
# forwards (3080 / 8080) so a local run can coexist with `task dev`.
export ROUTING_TRAEFIK_PORT="${ROUTING_TRAEFIK_PORT:-13080}"
export ROUTING_TRAEFIK_API_PORT="${ROUTING_TRAEFIK_API_PORT:-18080}"

# Logs for one stack run. Concurrent stacks that override ports or
# ROUTING_PROJECT_NAME must not share diagnostics: a failure would overwrite
# the other run. When ROUTING_RUN_DIR is unset and any of those knobs leave
# the defaults, isolate under a subdirectory named from the project + ports.
# Explicit ROUTING_RUN_DIR always wins. The default path e2e/routing/.run is
# kept for the standard single-stack / CI layout so artifacts stay stable.
if [[ -n "${_ROUTING_RUN_DIR_FROM_ENV}" ]]; then
  export ROUTING_RUN_DIR="${_ROUTING_RUN_DIR_FROM_ENV}"
else
  if [[ "${COMPOSE_PROJECT_NAME}" == "publira-routing" ]] &&
    [[ "${ROUTING_TRAEFIK_PORT}" == "13080" ]] &&
    [[ "${ROUTING_TRAEFIK_API_PORT}" == "18080" ]]; then
    export ROUTING_RUN_DIR="${ROUTING_DIR}/.run"
  else
    export ROUTING_RUN_DIR="${ROUTING_DIR}/.run/${COMPOSE_PROJECT_NAME}-tf${ROUTING_TRAEFIK_PORT}-api${ROUTING_TRAEFIK_API_PORT}"
  fi
fi
unset _ROUTING_RUN_DIR_FROM_ENV
RUN_DIR="${ROUTING_RUN_DIR}"
LOG_DIR="${RUN_DIR}/logs"

# Exclusive lock for the compose project. up.sh does `compose down` before
# starting, so a second run with the same project name would kill the first.
# The lock file is keyed by project name (the shared Docker resource), not by
# RUN_DIR. flock -n fails immediately; same ports still fail on port_in_use.
ROUTING_LOCK_FILE="${ROUTING_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lock"

ROUTING_READY_TIMEOUT_SEC="${ROUTING_READY_TIMEOUT_SEC:-60}"
ROUTING_READY_INTERVAL_SEC="${ROUTING_READY_INTERVAL_SEC:-1}"

# Router names Traefik derives from the Docker labels on `app`.
ROUTING_ROUTERS=(
  web-host
  web-admin
  web-platform
  api
  image-server
  admin-image-server
)

# Middleware names from the same labels. `strip-trace-context` is attached to
# the `web` entrypoint in the static configuration, so every router on that
# entrypoint refuses requests until the Docker provider has advertised it;
# waiting for it turns that into one readable message instead of a wall of
# failing probes.
ROUTING_MIDDLEWARES=(
  api-strip
  strip-trace-context
)

# W3C Trace Context a caller could forge. echo.py reports each of these
# headers back, so a probe can assert the backend saw none of them.
ROUTING_TRACE_CONTEXT_HEADERS=(
  "traceparent: 00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
  "tracestate: publira=forged"
  "baggage: publira=forged"
)

routing_log() {
  printf '[routing] %s\n' "$*"
}

routing_err() {
  printf '[routing] ERROR: %s\n' "$*" >&2
}

routing_fail() {
  routing_err "$*"
  exit 1
}

compose() {
  docker compose \
    -f "${ROOT_COMPOSE_FILE}" \
    -f "${DEVCONTAINER_COMPOSE_FILE}" \
    -f "${ROUTING_COMPOSE_FILE}" \
    -p "${COMPOSE_PROJECT_NAME}" \
    "$@"
}

ensure_run_dirs() {
  mkdir -p "${LOG_DIR}"
}

# Hold until this shell exits (the FD stays open). Children inherit
# ROUTING_LOCK_HELD=1 and skip re-acquire so `bash up.sh` from run.sh works.
acquire_routing_lock() {
  if [[ "${ROUTING_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  command -v flock >/dev/null 2>&1 ||
    routing_fail "flock is not available; compose project lock cannot be taken"
  mkdir -p "$(dirname "${ROUTING_LOCK_FILE}")"
  exec {ROUTING_LOCK_FD}>"${ROUTING_LOCK_FILE}"
  if ! flock -n "${ROUTING_LOCK_FD}"; then
    routing_fail "compose project ${COMPOSE_PROJECT_NAME} is already in use; wait or set ROUTING_PROJECT_NAME"
  fi
  export ROUTING_LOCK_HELD=1
}

require_port_tool() {
  command -v ss >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1 ||
    routing_fail "neither ss nor netstat is available; port checks cannot run"
}

port_in_use() {
  local port="$1"
  require_port_tool
  ss -ltn 2>/dev/null | grep -qE ":${port}\\b" ||
    netstat -ltn 2>/dev/null | grep -qE ":${port}\\b"
}

# Compact JSON field. Values we emit are identifiers or paths, never quotes.
json_string_field() {
  local json="$1" key="$2"
  printf '%s' "${json}" | sed -n "s/.*\"${key}\":\"\\([^\"]*\\)\".*/\\1/p"
}

json_number_field() {
  local json="$1" key="$2"
  printf '%s' "${json}" | sed -n "s/.*\"${key}\":\\([0-9][0-9]*\\).*/\\1/p"
}

# Routers Traefik has currently advertised on the insecure API.
traefik_router_names() {
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${ROUTING_TRAEFIK_API_PORT}/api/http/routers" |
    tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'
}

# Middlewares Traefik has currently advertised on the insecure API.
traefik_middleware_names() {
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${ROUTING_TRAEFIK_API_PORT}/api/http/middlewares" |
    tr ',' '\n' | sed -n 's/.*"name":"\([^"]*\)".*/\1/p'
}

# Arguments after the path are extra `Header: value` lines sent as-is.
http_probe() {
  local method="$1" host="$2" path="$3"
  shift 3
  local header_args=() header
  for header in "$@"; do
    header_args+=(-H "${header}")
  done
  local tmpfile code
  tmpfile="$(mktemp)"
  code="$(
    curl -sS -o "${tmpfile}" -w '%{http_code}' --max-time 5 \
      -X "${method}" \
      -H "Host: ${host}" \
      ${header_args[@]+"${header_args[@]}"} \
      "http://127.0.0.1:${ROUTING_TRAEFIK_PORT}${path}" 2>/dev/null || true
  )"
  printf '%s\n' "${code}"
  cat "${tmpfile}" 2>/dev/null || true
  rm -f "${tmpfile}"
}

# One documented route: method, Host, request path, backend name, forwarded path.
assert_route() {
  local name="$1" method="$2" host="$3" path="$4" want_backend="$5" want_path="$6"
  local out code body actual_backend actual_path

  out="$(http_probe "${method}" "${host}" "${path}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} ${method} ${path} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  actual_path="$(json_string_field "${body}" path)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} ${method} ${path} body=${body}"
  fi
  if [[ "${actual_path}" != "${want_path}" ]]; then
    routing_fail "${name}: path '${actual_path}' (want '${want_path}') host=${host} ${method} ${path} body=${body}"
  fi

  routing_log "ok: ${name} → ${want_backend}${want_path}"
}

# The same route with a forged W3C Trace Context on the request: the
# entrypoint middleware must drop all three headers before the backend sees
# them, and leave the routing and the strip-prefix alone.
assert_trace_context_stripped() {
  local name="$1" method="$2" host="$3" path="$4" want_backend="$5" want_path="$6"
  local out code body actual_backend actual_path header field value

  out="$(http_probe "${method}" "${host}" "${path}" "${ROUTING_TRACE_CONTEXT_HEADERS[@]}")"
  code="$(printf '%s' "${out}" | sed -n '1p')"
  body="$(printf '%s' "${out}" | tail -n +2)"

  if [[ "${code}" != "200" ]]; then
    routing_fail "${name}: HTTP ${code} (want 200) host=${host} ${method} ${path} body=${body}"
  fi

  actual_backend="$(json_string_field "${body}" backend)"
  actual_path="$(json_string_field "${body}" path)"
  if [[ "${actual_backend}" != "${want_backend}" ]]; then
    routing_fail "${name}: backend '${actual_backend}' (want '${want_backend}') host=${host} ${method} ${path} body=${body}"
  fi
  if [[ "${actual_path}" != "${want_path}" ]]; then
    routing_fail "${name}: path '${actual_path}' (want '${want_path}') host=${host} ${method} ${path} body=${body}"
  fi

  for header in "${ROUTING_TRACE_CONTEXT_HEADERS[@]}"; do
    field="${header%%:*}"
    value="$(json_string_field "${body}" "${field}")"
    if [[ -n "${value}" ]]; then
      routing_fail "${name}: backend saw ${field} '${value}' (want it stripped) host=${host} ${method} ${path} body=${body}"
    fi
  done

  routing_log "ok: ${name} → ${want_backend}${want_path} without trace context"
}

collect_diagnostics() {
  routing_err "collecting diagnostics into ${LOG_DIR}"
  mkdir -p "${LOG_DIR}"

  compose ps >"${LOG_DIR}/compose-ps.log" 2>&1 || true
  compose logs --no-color --tail 200 >"${LOG_DIR}/compose.log" 2>&1 || true
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${ROUTING_TRAEFIK_API_PORT}/api/http/routers" \
    >"${LOG_DIR}/traefik-routers.json" 2>&1 || true
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${ROUTING_TRAEFIK_API_PORT}/api/http/middlewares" \
    >"${LOG_DIR}/traefik-middlewares.json" 2>&1 || true

  local f
  for f in "${LOG_DIR}"/*.log "${LOG_DIR}"/*.json; do
    [[ -f "${f}" ]] || continue
    routing_err "--- tail $(basename "${f}") ---"
    tail -n 40 "${f}" >&2 || true
  done
}
