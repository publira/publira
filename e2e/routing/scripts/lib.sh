#!/usr/bin/env bash
# Shared helpers for the Dev Container Traefik routing check (#55).
#
# The check overlays .devcontainer/compose.yaml, keeps the real Traefik labels
# on `app`, and replaces the process behind those ports with echo.py so each
# probe can assert the backend and the path Traefik forwarded.
# shellcheck shell=bash

set -euo pipefail

ROUTING_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUTING_DIR="$(cd "${ROUTING_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${ROUTING_DIR}/../.." && pwd)"

# Dedicated project name: a run never touches the Dev Container stack.
export COMPOSE_PROJECT_NAME="${ROUTING_PROJECT_NAME:-publira-routing}"
DEVCONTAINER_COMPOSE_FILE="${REPO_ROOT}/.devcontainer/compose.yaml"
ROUTING_COMPOSE_FILE="${ROUTING_DIR}/compose.override.yaml"

# Absolute: the overlay's first `-f` is .devcontainer/compose.yaml, so a
# relative volume would resolve against that directory, not this one.
export ROUTING_ECHO_PY="${ROUTING_DIR}/echo.py"

# Host ports published by compose.override.yaml. Offset from the Dev Container
# forwards (3080 / 8080) so a local run can coexist with `task dev`.
export ROUTING_TRAEFIK_PORT="${ROUTING_TRAEFIK_PORT:-13080}"
export ROUTING_TRAEFIK_API_PORT="${ROUTING_TRAEFIK_API_PORT:-18080}"

RUN_DIR="${ROUTING_DIR}/.run"
LOG_DIR="${RUN_DIR}/logs"

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
    -f "${DEVCONTAINER_COMPOSE_FILE}" \
    -f "${ROUTING_COMPOSE_FILE}" \
    -p "${COMPOSE_PROJECT_NAME}" \
    "$@"
}

ensure_run_dirs() {
  mkdir -p "${LOG_DIR}"
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

http_probe() {
  local method="$1" host="$2" path="$3"
  local tmpfile code
  tmpfile="$(mktemp)"
  code="$(
    curl -sS -o "${tmpfile}" -w '%{http_code}' --max-time 5 \
      -X "${method}" \
      -H "Host: ${host}" \
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

collect_diagnostics() {
  routing_err "collecting diagnostics into ${LOG_DIR}"
  mkdir -p "${LOG_DIR}"

  compose ps >"${LOG_DIR}/compose-ps.log" 2>&1 || true
  compose logs --no-color --tail 200 >"${LOG_DIR}/compose.log" 2>&1 || true
  curl -fsS --max-time 3 \
    "http://127.0.0.1:${ROUTING_TRAEFIK_API_PORT}/api/http/routers" \
    >"${LOG_DIR}/traefik-routers.json" 2>&1 || true

  local f
  for f in "${LOG_DIR}"/*.log "${LOG_DIR}"/*.json; do
    [[ -f "${f}" ]] || continue
    routing_err "--- tail $(basename "${f}") ---"
    tail -n 40 "${f}" >&2 || true
  done
}
