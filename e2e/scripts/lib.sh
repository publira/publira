#!/usr/bin/env bash
# Shared helpers for E2E lifecycle scripts.
# shellcheck shell=bash

set -euo pipefail

E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${E2E_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${E2E_DIR}/.." && pwd)"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-publira-e2e}"
export COMPOSE_FILE="${COMPOSE_FILE:-${E2E_DIR}/compose.yaml}"

# Host ports published by e2e/compose.yaml
export E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-5433}"
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-6380}"

export E2E_WEB_HOST_PORT="${E2E_WEB_HOST_PORT:-3000}"
export E2E_WEB_ADMIN_PORT="${E2E_WEB_ADMIN_PORT:-4000}"
export E2E_PUBLIC_API_PORT="${E2E_PUBLIC_API_PORT:-8000}"
export E2E_PUBLIC_API_GRPC_PORT="${E2E_PUBLIC_API_GRPC_PORT:-8100}"
export E2E_ADMIN_API_PORT="${E2E_ADMIN_API_PORT:-8001}"
export E2E_ADMIN_API_GRPC_PORT="${E2E_ADMIN_API_GRPC_PORT:-8101}"

export PUBLIRA_DB_URL="${PUBLIRA_DB_URL:-postgres://postgres:password@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL:-postgres://publira_public:publicpass@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL:-postgres://publira_admin:adminpass@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:${E2E_REDIS_PORT}}"
export PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL:-http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}}"
export PUBLIRA_ADMIN_GRPC_URL="${PUBLIRA_ADMIN_GRPC_URL:-http://127.0.0.1:${E2E_ADMIN_API_GRPC_PORT}}"
export E2E_WEB_HOST_BASE_URL="${E2E_WEB_HOST_BASE_URL:-http://localhost:${E2E_WEB_HOST_PORT}}"
export E2E_WEB_ADMIN_BASE_URL="${E2E_WEB_ADMIN_BASE_URL:-http://admin.localhost:${E2E_WEB_ADMIN_PORT}}"
export E2E_PUBLIC_API_BASE_URL="${E2E_PUBLIC_API_BASE_URL:-http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}}"
export E2E_ADMIN_API_BASE_URL="${E2E_ADMIN_API_BASE_URL:-http://127.0.0.1:${E2E_ADMIN_API_GRPC_PORT}}"

# publish-episodes interval (seconds). Short so scheduled episodes can land in
# the same Playwright run without multi-minute waits.
export E2E_PUBLISH_EPISODES_INTERVAL_SEC="${E2E_PUBLISH_EPISODES_INTERVAL_SEC:-2}"

export NEXT_CACHE_APP="${NEXT_CACHE_APP:-web-host}"
export STORAGE_BACKEND="${STORAGE_BACKEND:-local}"

# PID files, logs, and local storage for one stack run. Concurrent runs that
# override E2E_*_PORT (or COMPOSE_PROJECT_NAME) must set a distinct E2E_RUN_DIR
# so stop/start does not clobber another run's processes. Default stays
# e2e/.run so CI artifacts keep the existing path.
export E2E_RUN_DIR="${E2E_RUN_DIR:-${E2E_DIR}/.run}"
export LOCAL_STORAGE_DIR="${LOCAL_STORAGE_DIR:-${E2E_RUN_DIR}/storage}"

RUN_DIR="${E2E_RUN_DIR}"
LOG_DIR="${RUN_DIR}/logs"
PID_DIR="${RUN_DIR}/pids"

e2e_log() {
  printf '[e2e] %s\n' "$*"
}

e2e_err() {
  printf '[e2e] ERROR: %s\n' "$*" >&2
}

compose() {
  docker compose -f "${COMPOSE_FILE}" -p "${COMPOSE_PROJECT_NAME}" "$@"
}

ensure_run_dirs() {
  mkdir -p "${LOG_DIR}" "${PID_DIR}" "${LOCAL_STORAGE_DIR}"
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null
}

# Process start time as a fingerprint to detect PID reuse (see stop_pid_file).
pid_start_time() {
  local pid="$1"
  ps -o lstart= -p "${pid}" 2>/dev/null | xargs || true
}

read_pid() {
  local name="$1"
  local file="${PID_DIR}/${name}.pid"
  if [[ -f "${file}" ]]; then
    sed -n '1p' "${file}"
  fi
}

write_pid() {
  local name="$1"
  local pid="$2"
  printf '%s\n%s\n' "${pid}" "$(pid_start_time "${pid}")" >"${PID_DIR}/${name}.pid"
}

stop_pid_file() {
  local name="$1"
  local file="${PID_DIR}/${name}.pid"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi
  local pid recorded_start
  pid="$(sed -n '1p' "${file}" 2>/dev/null || true)"
  recorded_start="$(sed -n '2p' "${file}" 2>/dev/null || true)"
  if ! is_pid_running "${pid}"; then
    rm -f "${file}"
    return 0
  fi
  # Guard against a reused PID belonging to an unrelated process.
  if [[ -z "${recorded_start}" || "$(pid_start_time "${pid}")" != "${recorded_start}" ]]; then
    e2e_log "skipping ${name}: pid ${pid} start time does not match (likely reused)"
    rm -f "${file}"
    return 0
  fi
  e2e_log "stopping ${name} (pid ${pid})"
  kill "${pid}" 2>/dev/null || true
  local _
  for _ in $(seq 1 30); do
    if ! is_pid_running "${pid}"; then
      break
    fi
    sleep 0.2
  done
  if is_pid_running "${pid}"; then
    e2e_log "force-killing ${name} (pid ${pid})"
    kill -9 "${pid}" 2>/dev/null || true
  fi
  rm -f "${file}"
}
