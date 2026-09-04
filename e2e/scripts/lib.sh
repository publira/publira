#!/usr/bin/env bash
# Shared helpers for E2E lifecycle scripts.
# shellcheck shell=bash

set -euo pipefail

E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
E2E_DIR="$(cd "${E2E_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${E2E_DIR}/.." && pwd)"

# Capture before defaults so we can tell "caller set E2E_RUN_DIR" from "unset".
_E2E_RUN_DIR_FROM_ENV="${E2E_RUN_DIR-}"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-publira-e2e}"
export COMPOSE_FILE="${COMPOSE_FILE:-${E2E_DIR}/compose.yaml}"

# Host ports published by e2e/compose.yaml
export E2E_POSTGRES_PORT="${E2E_POSTGRES_PORT:-5433}"
export E2E_REDIS_PORT="${E2E_REDIS_PORT:-6380}"
export E2E_RUSTFS_PORT="${E2E_RUSTFS_PORT:-9003}"
export E2E_MAILPIT_SMTP_PORT="${E2E_MAILPIT_SMTP_PORT:-1026}"
export E2E_MAILPIT_HTTP_PORT="${E2E_MAILPIT_HTTP_PORT:-8026}"

export E2E_WEB_HOST_PORT="${E2E_WEB_HOST_PORT:-3000}"
export E2E_WEB_ADMIN_PORT="${E2E_WEB_ADMIN_PORT:-4000}"
export E2E_WEB_PLATFORM_PORT="${E2E_WEB_PLATFORM_PORT:-4100}"
export E2E_PUBLIC_API_PORT="${E2E_PUBLIC_API_PORT:-8000}"
export E2E_PUBLIC_API_GRPC_PORT="${E2E_PUBLIC_API_GRPC_PORT:-8100}"
export E2E_ADMIN_API_PORT="${E2E_ADMIN_API_PORT:-8001}"
export E2E_ADMIN_API_GRPC_PORT="${E2E_ADMIN_API_GRPC_PORT:-8101}"
export E2E_PLATFORM_API_PORT="${E2E_PLATFORM_API_PORT:-8002}"
export E2E_PLATFORM_API_GRPC_PORT="${E2E_PLATFORM_API_GRPC_PORT:-8102}"
export E2E_OUTBOX_WORKER_PORT="${E2E_OUTBOX_WORKER_PORT:-8003}"
export E2E_IMAGE_SERVER_PORT="${E2E_IMAGE_SERVER_PORT:-8200}"
# Traefik entrypoint. `/images` belongs to image-server and everything else to
# web-host, so the browser can reach both from one origin the way the Dev
# Container edge serves them.
export E2E_EDGE_PORT="${E2E_EDGE_PORT:-3080}"

export PUBLIRA_DB_URL="${PUBLIRA_DB_URL:-postgres://postgres:password@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL:-postgres://publira_public:publicpass@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL:-postgres://publira_admin:adminpass@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_PLATFORM_DB_URL="${PUBLIRA_PLATFORM_DB_URL:-postgres://publira_platform:platformpass@127.0.0.1:${E2E_POSTGRES_PORT}/publira?sslmode=disable}"
# Always the E2E compose Redis. Do not inherit ambient PUBLIRA_REDIS_URL — the
# devcontainer / `task dev` value is redis://redis:6379 and would serve
# another build's cached HTML (login then hangs waiting to hydrate).
export PUBLIRA_REDIS_URL="redis://127.0.0.1:${E2E_REDIS_PORT}"
export PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-publira}"
# Same reasoning as PUBLIRA_REDIS_URL: the devcontainer exports
# PUBLIRA_S3_ENDPOINT=http://rustfs:9000, so an inherited value would store
# E2E uploads in the dev stack's RustFS (and is unreachable once it is down).
export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:${E2E_RUSTFS_PORT}"
export PUBLIRA_S3_FORCE_PATH_STYLE="true"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-publira}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-publirapass}"
export PUBLIRA_PUBLIC_GRPC_URL="${PUBLIRA_PUBLIC_GRPC_URL:-http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}}"
export PUBLIRA_ADMIN_GRPC_URL="${PUBLIRA_ADMIN_GRPC_URL:-http://127.0.0.1:${E2E_ADMIN_API_GRPC_PORT}}"
export PUBLIRA_PLATFORM_GRPC_URL="${PUBLIRA_PLATFORM_GRPC_URL:-http://127.0.0.1:${E2E_PLATFORM_API_GRPC_PORT}}"
export E2E_WEB_HOST_BASE_URL="${E2E_WEB_HOST_BASE_URL:-http://localhost:${E2E_WEB_HOST_PORT}}"
export E2E_WEB_ADMIN_BASE_URL="${E2E_WEB_ADMIN_BASE_URL:-http://admin.localhost:${E2E_WEB_ADMIN_PORT}}"
export E2E_WEB_PLATFORM_BASE_URL="${E2E_WEB_PLATFORM_BASE_URL:-http://platform.localhost:${E2E_WEB_PLATFORM_PORT}}"
export E2E_PUBLIC_API_BASE_URL="${E2E_PUBLIC_API_BASE_URL:-http://127.0.0.1:${E2E_PUBLIC_API_GRPC_PORT}}"
export E2E_ADMIN_API_BASE_URL="${E2E_ADMIN_API_BASE_URL:-http://127.0.0.1:${E2E_ADMIN_API_GRPC_PORT}}"
export E2E_PLATFORM_API_BASE_URL="${E2E_PLATFORM_API_BASE_URL:-http://127.0.0.1:${E2E_PLATFORM_API_GRPC_PORT}}"
# Same web-host, reached through the edge. Only the viewer performance suite
# uses it, because it is the only one that needs `/images` to resolve.
export E2E_WEB_HOST_EDGE_BASE_URL="${E2E_WEB_HOST_EDGE_BASE_URL:-http://localhost:${E2E_EDGE_PORT}}"
# Mailpit's HTTP API. A spec reads the confirmation link out of the message a
# flow mailed, because the database keeps only the token's hash.
export E2E_MAILPIT_BASE_URL="${E2E_MAILPIT_BASE_URL:-http://127.0.0.1:${E2E_MAILPIT_HTTP_PORT}}"

# publish-episodes interval (seconds). Short so scheduled episodes can land in
# the same Playwright run without multi-minute waits.
export E2E_PUBLISH_EPISODES_INTERVAL_SEC="${E2E_PUBLISH_EPISODES_INTERVAL_SEC:-2}"

export PUBLIRA_CACHE_APP="${PUBLIRA_CACHE_APP:-web-host}"

# Session cookie (JWE) key for the three Next.js apps. Required — the apps have
# no fallback. Test-stack value only; inheriting the devcontainer's is fine
# because nothing here depends on which key it is, only that one is set.
export PUBLIRA_AUTH_SECRET="${PUBLIRA_AUTH_SECRET:-publira-e2e-only-insecure-web-session-secret}"

# Access token (HS256) signing key for the Go API servers. Required — they exit
# at startup without it. Same reasoning as PUBLIRA_AUTH_SECRET above: any value
# works as long as every process in the stack shares it.
export PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET:-publira-e2e-only-insecure-access-token-secret}"

# Next.js cache-tag revalidation. Without a token the Go servers build no
# revalidate client at all, so every RevalidateTags call is a no-op and a
# setting saved through a console stays behind a `"use cache"` entry for the
# whole run. The token is the shared secret between those servers and the
# revalidate Route Handler each web app mounts; any value works as long as
# every process in the stack has the same one.
export PUBLIRA_REVALIDATE_TOKEN="${PUBLIRA_REVALIDATE_TOKEN:-publira-e2e-only-insecure-revalidate-token}"

# Where the servers send the tags. Always built from the E2E ports, for the
# same reason as PUBLIRA_REDIS_URL above: an inherited Dev Container value
# names the dev stack's apps, so the tags would drop another build's cache
# entries and leave this run's untouched. The hostnames follow how start-apps
# binds each app — web-host binds `localhost`, while web-admin and
# web-platform bind 0.0.0.0 and are reached over IPv4.
export PUBLIRA_WEB_HOST_INTERNAL_URL="http://localhost:${E2E_WEB_HOST_PORT}"
export PUBLIRA_WEB_ADMIN_INTERNAL_URL="http://127.0.0.1:${E2E_WEB_ADMIN_PORT}"
export PUBLIRA_WEB_PLATFORM_INTERNAL_URL="http://127.0.0.1:${E2E_WEB_PLATFORM_PORT}"

# PID files, logs, and local storage for one stack run.
#
# Concurrent stacks that override ports or COMPOSE_PROJECT_NAME must not share
# PID/log state: stop-apps would kill the other run. When E2E_RUN_DIR is unset
# and any of those knobs leave the defaults, isolate under a subdirectory named
# from the project + port numbers (same overrides → same path). Explicit
# E2E_RUN_DIR always wins. The default path e2e/.run is kept for the standard
# single-stack / CI layout so artifacts stay stable.
if [[ -n "${_E2E_RUN_DIR_FROM_ENV}" ]]; then
  export E2E_RUN_DIR="${_E2E_RUN_DIR_FROM_ENV}"
else
  _e2e_uses_default_stack=1
  if [[ "${COMPOSE_PROJECT_NAME}" != "publira-e2e" ]] ||
    [[ "${E2E_POSTGRES_PORT}" != "5433" ]] ||
    [[ "${E2E_REDIS_PORT}" != "6380" ]] ||
    [[ "${E2E_RUSTFS_PORT}" != "9003" ]] ||
    [[ "${E2E_MAILPIT_SMTP_PORT}" != "1026" ]] ||
    [[ "${E2E_MAILPIT_HTTP_PORT}" != "8026" ]] ||
    [[ "${E2E_WEB_HOST_PORT}" != "3000" ]] ||
    [[ "${E2E_WEB_ADMIN_PORT}" != "4000" ]] ||
    [[ "${E2E_WEB_PLATFORM_PORT}" != "4100" ]] ||
    [[ "${E2E_PUBLIC_API_PORT}" != "8000" ]] ||
    [[ "${E2E_PUBLIC_API_GRPC_PORT}" != "8100" ]] ||
    [[ "${E2E_ADMIN_API_PORT}" != "8001" ]] ||
    [[ "${E2E_ADMIN_API_GRPC_PORT}" != "8101" ]] ||
    [[ "${E2E_PLATFORM_API_PORT}" != "8002" ]] ||
    [[ "${E2E_PLATFORM_API_GRPC_PORT}" != "8102" ]] ||
    [[ "${E2E_OUTBOX_WORKER_PORT}" != "8003" ]] ||
    [[ "${E2E_IMAGE_SERVER_PORT}" != "8200" ]] ||
    [[ "${E2E_EDGE_PORT}" != "3080" ]]; then
    _e2e_uses_default_stack=0
  fi
  if [[ "${_e2e_uses_default_stack}" -eq 1 ]]; then
    export E2E_RUN_DIR="${E2E_DIR}/.run"
  else
    # Directory name encodes the override set so start/stop/wait in one session
    # share state, while a different port set gets its own directory.
    export E2E_RUN_DIR="${E2E_DIR}/.run/${COMPOSE_PROJECT_NAME}-pg${E2E_POSTGRES_PORT}-rd${E2E_REDIS_PORT}-s3${E2E_RUSTFS_PORT}-mp${E2E_MAILPIT_SMTP_PORT}-${E2E_MAILPIT_HTTP_PORT}-h${E2E_WEB_HOST_PORT}-a${E2E_WEB_ADMIN_PORT}-p${E2E_WEB_PLATFORM_PORT}-api${E2E_PUBLIC_API_PORT}-${E2E_PUBLIC_API_GRPC_PORT}-adm${E2E_ADMIN_API_PORT}-${E2E_ADMIN_API_GRPC_PORT}-plt${E2E_PLATFORM_API_PORT}-${E2E_PLATFORM_API_GRPC_PORT}-ow${E2E_OUTBOX_WORKER_PORT}-img${E2E_IMAGE_SERVER_PORT}-edge${E2E_EDGE_PORT}"
  fi
  unset _e2e_uses_default_stack
fi
unset _E2E_RUN_DIR_FROM_ENV

RUN_DIR="${E2E_RUN_DIR}"
LOG_DIR="${RUN_DIR}/logs"
PID_DIR="${RUN_DIR}/pids"
# Traefik reads its routers from a watched directory. The backend ports are
# overridable, so the file is written per run rather than committed, and
# compose mounts it through this variable.
export E2E_TRAEFIK_DYNAMIC_DIR="${RUN_DIR}/traefik"

# Lease for the compose project. Docker resources are keyed by
# COMPOSE_PROJECT_NAME, so a second stack with the same project would
# compose-down the first. A background holder keeps the lease after up.sh
# exits; only the owning E2E_RUN_DIR may release it (down.sh).
E2E_LOCK_FILE="${E2E_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lock"
E2E_LEASE_FILE="${E2E_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lease"

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
  mkdir -p "${LOG_DIR}" "${PID_DIR}" "${E2E_TRAEFIK_DYNAMIC_DIR}"
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

e2e_lease_run_dir() {
  sed -n '1p' "${E2E_LEASE_FILE}" 2>/dev/null || true
}

e2e_lease_holder_alive() {
  local pid recorded_start
  [[ -f "${E2E_LEASE_FILE}" ]] || return 1
  pid="$(sed -n '2p' "${E2E_LEASE_FILE}" 2>/dev/null || true)"
  recorded_start="$(sed -n '3p' "${E2E_LEASE_FILE}" 2>/dev/null || true)"
  is_pid_running "${pid}" || return 1
  [[ -n "${recorded_start}" && "$(pid_start_time "${pid}")" == "${recorded_start}" ]]
}

e2e_refuse_foreign_lease() {
  e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use (owned by $(e2e_lease_run_dir)); wait or set COMPOSE_PROJECT_NAME and E2E_*_PORT"
  exit 1
}

# True while nothing holds the compose-project lock.
e2e_lock_is_free() {
  if ! command -v flock >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -e "${E2E_LOCK_FILE}" ]]; then
    return 0
  fi
  flock -n "${E2E_LOCK_FILE}" true 2>/dev/null
}

# E2E_LOCK_FILE keeps whatever path the caller reached the repository through,
# symlinks included, while /proc reports the physical one. Resolve the directory
# with `pwd -P` so the two can be compared (`readlink -f` is GNU-only).
e2e_lock_file_physical() {
  local dir
  dir="$(cd "$(dirname "${E2E_LOCK_FILE}")" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "${dir}" "$(basename "${E2E_LOCK_FILE}")"
}

# PIDs with the lock file open, newline separated. The lease file normally
# records the holder; this is the fallback for when it is gone and the pid has
# to be recovered from the kernel instead. Linux only — elsewhere the caller
# falls back to printing a recovery hint.
e2e_lock_holder_pids() {
  local fd pid target physical
  if [[ ! -d /proc || ! -e "${E2E_LOCK_FILE}" ]]; then
    return 0
  fi
  physical="$(e2e_lock_file_physical || true)"
  physical="${physical:-${E2E_LOCK_FILE}}"
  for fd in /proc/[0-9]*/fd/*; do
    target="$(readlink "${fd}" 2>/dev/null || true)"
    if [[ "${target}" != "${E2E_LOCK_FILE}" && "${target}" != "${physical}" ]]; then
      continue
    fi
    pid="${fd#/proc/}"
    pid="${pid%%/*}"
    if [[ "${pid}" == "$$" || "${pid}" == "${BASHPID}" ]]; then
      continue
    fi
    printf '%s\n' "${pid}"
  done | sort -un
}

e2e_lock_holder_hint() {
  printf "identify it with 'fuser %s' or 'lsof %s', then kill it" "${E2E_LOCK_FILE}" "${E2E_LOCK_FILE}"
}

# SIGTERM, then SIGKILL. Best effort: callers verify by the lock, not the pid,
# because a reaped-late zombie still answers `kill -0`.
e2e_terminate_pid() {
  local pid="$1" _
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  kill "${pid}" 2>/dev/null || true
  for _ in $(seq 1 30); do
    if ! is_pid_running "${pid}"; then
      return 0
    fi
    sleep 0.1
  done
  kill -9 "${pid}" 2>/dev/null || true
}

# Teardown removes the lease file, so a holder that outlives it can never be
# named again and every later acquire fails with no way back. Find it
# through /proc and take the lock back.
e2e_reclaim_orphan_lock() {
  local pid pids _
  # A just-killed holder releases the descriptor asynchronously, so give the
  # lock a moment before concluding someone else still owns it. Without the
  # wait, a platform with no /proc to search would fail teardown outright.
  for _ in $(seq 1 30); do
    if e2e_lock_is_free; then
      return 0
    fi
    sleep 0.1
  done
  pids="$(e2e_lock_holder_pids)"
  if [[ -z "${pids}" ]]; then
    e2e_err "compose project ${COMPOSE_PROJECT_NAME} lock ${E2E_LOCK_FILE} is held by an unidentified process; $(e2e_lock_holder_hint)"
    return 1
  fi
  while read -r pid; do
    if [[ -z "${pid}" ]]; then
      continue
    fi
    e2e_log "reclaiming ${COMPOSE_PROJECT_NAME} lock from orphaned holder (pid ${pid})"
    e2e_terminate_pid "${pid}"
  done <<<"${pids}"
  for _ in $(seq 1 30); do
    if e2e_lock_is_free; then
      return 0
    fi
    sleep 0.1
  done
  e2e_err "compose project ${COMPOSE_PROJECT_NAME} lock ${E2E_LOCK_FILE} is still held after killing $(tr '\n' ' ' <<<"${pids}" | sed 's/ $//'); $(e2e_lock_holder_hint)"
  return 1
}

# The lock is taken but no lease names the owner: without the pid the reader
# cannot act, so print it.
e2e_report_lock_holders() {
  local pids
  pids="$(e2e_lock_holder_pids)"
  if [[ -z "${pids}" ]]; then
    e2e_err "lock ${E2E_LOCK_FILE} is held but no lease file names the owner; $(e2e_lock_holder_hint)"
    return 0
  fi
  e2e_err "lock ${E2E_LOCK_FILE} is held by pid(s) $(tr '\n' ' ' <<<"${pids}" | sed 's/ $//') with no lease file; run 'task e2e:down' to reclaim it"
}

# Detached holder so the lease outlives up.sh / start-apps.sh. Leftover-stack
# commands with the same E2E_RUN_DIR join; a different RUN_DIR is refused.
e2e_spawn_lease_holder() {
  mkdir -p "$(dirname "${E2E_LOCK_FILE}")"
  local ready pid waited
  ready="$(mktemp)"
  # Detached from the caller's stdio: the holder outlives up.sh, and keeping the
  # inherited pipe open blocks whoever reads its output until teardown.
  (
    if command -v flock >/dev/null 2>&1; then
      exec 9>"${E2E_LOCK_FILE}"
      flock -n 9 || exit 1
    fi
    printf '%s\n' "${BASHPID}" >"${ready}"
    # exec so the recorded pid *is* the process holding fd 9. A `sleep` child
    # would inherit the descriptor and keep the flock alive after the holder is
    # killed, stranding the project with no lease file to recover from.
    # The delay is ~68 years; `sleep infinity` is GNU-only.
    exec sleep 2147483647
  ) </dev/null >/dev/null 2>&1 &
  waited=0
  while [[ ! -s "${ready}" ]]; do
    if ! kill -0 $! 2>/dev/null && [[ ! -s "${ready}" ]]; then
      rm -f "${ready}"
      e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use; wait or set COMPOSE_PROJECT_NAME and E2E_*_PORT"
      e2e_report_lock_holders
      exit 1
    fi
    if ((waited > 50)); then
      rm -f "${ready}"
      e2e_err "compose project ${COMPOSE_PROJECT_NAME} lock holder did not start"
      exit 1
    fi
    sleep 0.1
    waited=$((waited + 1))
  done
  pid="$(cat "${ready}")"
  rm -f "${ready}"
  printf '%s\n%s\n%s\n' "${E2E_RUN_DIR}" "${pid}" "$(pid_start_time "${pid}")" >"${E2E_LEASE_FILE}"
}

# Spawn a holder or join the existing owner. Children inherit E2E_LOCK_HELD=1
# and skip so `bash up.sh` from run.sh does not spawn a second holder.
acquire_e2e_lock() {
  if [[ "${E2E_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" == "${E2E_RUN_DIR}" ]]; then
      export E2E_LOCK_HELD=1
      return 0
    fi
    e2e_refuse_foreign_lease
  fi
  rm -f "${E2E_LEASE_FILE}"
  e2e_spawn_lease_holder
  export E2E_LOCK_HELD=1
}

# stop-apps must not create a lease; it only refuses a foreign owner.
join_e2e_lease() {
  if [[ "${E2E_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" == "${E2E_RUN_DIR}" ]]; then
      export E2E_LOCK_HELD=1
      return 0
    fi
    e2e_refuse_foreign_lease
  fi
}

require_e2e_owner_or_free() {
  if e2e_lease_holder_alive && [[ "$(e2e_lease_run_dir)" != "${E2E_RUN_DIR}" ]]; then
    e2e_refuse_foreign_lease
  fi
}

# Owner-only. A leftover `task e2e:down` matches the lease RUN_DIR and succeeds;
# a second stack with another E2E_RUN_DIR cannot tear the first down.
release_e2e_lease() {
  local pid
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" != "${E2E_RUN_DIR}" ]]; then
      e2e_refuse_foreign_lease
    fi
    pid="$(sed -n '2p' "${E2E_LEASE_FILE}" 2>/dev/null || true)"
    e2e_terminate_pid "${pid}"
  fi
  rm -f "${E2E_LEASE_FILE}"
  # Nothing owns the lock now, so anything still holding it is an orphan from a
  # crashed or hard-killed run: teardown is the place that can free it.
  e2e_reclaim_orphan_lock
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
