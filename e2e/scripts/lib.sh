#!/usr/bin/env bash
# Shared helpers for E2E lifecycle scripts.
# shellcheck shell=bash disable=SC2034 # read by scripts that source this file

set -euo pipefail

PUBLIRA_E2E_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLIRA_E2E_DIR="$(cd "${PUBLIRA_E2E_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PUBLIRA_E2E_DIR}/.." && pwd)"

# Capture before defaults so we can tell "caller set PUBLIRA_E2E_RUN_DIR" from "unset".
_E2E_RUN_DIR_FROM_ENV="${PUBLIRA_E2E_RUN_DIR-}"

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-publira-e2e}"
export COMPOSE_FILE="${COMPOSE_FILE:-${PUBLIRA_E2E_DIR}/compose.yaml}"

# Host ports published by e2e/compose.yaml
export PUBLIRA_E2E_POSTGRES_PORT="${PUBLIRA_E2E_POSTGRES_PORT:-5433}"
export PUBLIRA_E2E_REDIS_PORT="${PUBLIRA_E2E_REDIS_PORT:-6380}"
export PUBLIRA_E2E_RUSTFS_PORT="${PUBLIRA_E2E_RUSTFS_PORT:-9003}"
export PUBLIRA_E2E_MAILPIT_SMTP_PORT="${PUBLIRA_E2E_MAILPIT_SMTP_PORT:-1026}"
export PUBLIRA_E2E_MAILPIT_HTTP_PORT="${PUBLIRA_E2E_MAILPIT_HTTP_PORT:-8026}"

export PUBLIRA_E2E_WEB_HOST_PORT="${PUBLIRA_E2E_WEB_HOST_PORT:-3000}"
export PUBLIRA_E2E_WEB_ADMIN_PORT="${PUBLIRA_E2E_WEB_ADMIN_PORT:-4000}"
export PUBLIRA_E2E_WEB_PLATFORM_PORT="${PUBLIRA_E2E_WEB_PLATFORM_PORT:-4100}"
export PUBLIRA_E2E_PUBLIC_API_PORT="${PUBLIRA_E2E_PUBLIC_API_PORT:-8000}"
export PUBLIRA_E2E_PUBLIC_API_GRPC_PORT="${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT:-8100}"
export PUBLIRA_E2E_WORKER_PORT="${PUBLIRA_E2E_WORKER_PORT:-8003}"
export PUBLIRA_E2E_IMAGE_SERVER_PORT="${PUBLIRA_E2E_IMAGE_SERVER_PORT:-8200}"
export PUBLIRA_E2E_EMAIL_RENDERER_PORT="${PUBLIRA_E2E_EMAIL_RENDERER_PORT:-8300}"
# Traefik entrypoint. `/images` belongs to image-server and everything else to
# web-host, so the browser can reach both from one origin the way the Dev
# Container edge serves them.
export PUBLIRA_E2E_EDGE_PORT="${PUBLIRA_E2E_EDGE_PORT:-3080}"
# The pinned browser the screenshot projects connect to, so a baseline taken
# here and the comparison run on CI are rasterized by the same fonts.
export PUBLIRA_E2E_BROWSER_PORT="${PUBLIRA_E2E_BROWSER_PORT:-3090}"

export PUBLIRA_DB_URL="${PUBLIRA_DB_URL:-postgres://postgres:password@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_PUBLIC_DB_URL="${PUBLIRA_PUBLIC_DB_URL:-postgres://publira_public:publicpass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_ADMIN_DB_URL="${PUBLIRA_ADMIN_DB_URL:-postgres://publira_admin:adminpass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_PLATFORM_DB_URL="${PUBLIRA_PLATFORM_DB_URL:-postgres://publira_platform:platformpass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_WORKER_DB_URL="${PUBLIRA_WORKER_DB_URL:-postgres://publira_outbox:outboxpass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_TICKER_DB_URL="${PUBLIRA_TICKER_DB_URL:-postgres://publira_ticker:tickerpass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
export PUBLIRA_CONTENT_STATS_DB_URL="${PUBLIRA_CONTENT_STATS_DB_URL:-postgres://publira_content_stats:contentstatspass@127.0.0.1:${PUBLIRA_E2E_POSTGRES_PORT}/publira?sslmode=disable}"
# Always the E2E compose Redis. Do not inherit ambient PUBLIRA_REDIS_URL — the
# devcontainer / `task dev` value is redis://redis:6379 and would serve
# another build's cached HTML (login then hangs waiting to hydrate).
export PUBLIRA_REDIS_URL="redis://127.0.0.1:${PUBLIRA_E2E_REDIS_PORT}"
export PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-publira}"

# Same reasoning as PUBLIRA_REDIS_URL: the devcontainer exports
# PUBLIRA_S3_ENDPOINT=http://rustfs:9000, so an inherited value would store
# E2E uploads in the dev stack's RustFS (and is unreachable once it is down).
export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:${PUBLIRA_E2E_RUSTFS_PORT}"
export PUBLIRA_S3_FORCE_PATH_STYLE="true"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-publira}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-publirapass}"
# The API server's internal listener, which every app dials: one process
# carries all three Connect namespaces.
export PUBLIRA_GRPC_URL="${PUBLIRA_GRPC_URL:-http://127.0.0.1:${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}}"
export PUBLIRA_E2E_WEB_HOST_BASE_URL="${PUBLIRA_E2E_WEB_HOST_BASE_URL:-http://localhost:${PUBLIRA_E2E_WEB_HOST_PORT}}"
export PUBLIRA_E2E_WEB_ADMIN_BASE_URL="${PUBLIRA_E2E_WEB_ADMIN_BASE_URL:-http://admin.localhost:${PUBLIRA_E2E_WEB_ADMIN_PORT}}"
export PUBLIRA_E2E_WEB_PLATFORM_BASE_URL="${PUBLIRA_E2E_WEB_PLATFORM_BASE_URL:-http://platform.localhost:${PUBLIRA_E2E_WEB_PLATFORM_PORT}}"
export PUBLIRA_E2E_PUBLIC_API_BASE_URL="${PUBLIRA_E2E_PUBLIC_API_BASE_URL:-http://127.0.0.1:${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}}"
# Same web-host, reached through the edge, by every suite that opens an
# episode body: `/images` resolves on no other origin.
export PUBLIRA_E2E_WEB_HOST_EDGE_BASE_URL="${PUBLIRA_E2E_WEB_HOST_EDGE_BASE_URL:-http://localhost:${PUBLIRA_E2E_EDGE_PORT}}"
# Mailpit's HTTP API. A spec reads the confirmation link out of the message a
# flow mailed, because the database keeps only the token's hash.
export PUBLIRA_E2E_MAILPIT_BASE_URL="${PUBLIRA_E2E_MAILPIT_BASE_URL:-http://127.0.0.1:${PUBLIRA_E2E_MAILPIT_HTTP_PORT}}"
# Built from the port like the rest, so a second stack's screenshot projects
# reach that stack's browser rather than the first one's.
export PUBLIRA_E2E_BROWSER_WS_ENDPOINT="${PUBLIRA_E2E_BROWSER_WS_ENDPOINT:-ws://127.0.0.1:${PUBLIRA_E2E_BROWSER_PORT}}"

# The three periodic jobs the worker runs, in seconds. Short so a
# scheduled episode, a free window boundary, and a tenant's midnight all land
# within the same Playwright run instead of after multi-minute waits.
export PUBLIRA_E2E_PUBLISH_EPISODES_INTERVAL_SEC="${PUBLIRA_E2E_PUBLISH_EPISODES_INTERVAL_SEC:-2}"
export PUBLIRA_E2E_FREE_WINDOW_INTERVAL_SEC="${PUBLIRA_E2E_FREE_WINDOW_INTERVAL_SEC:-2}"
export PUBLIRA_E2E_TENANT_DAY_INTERVAL_SEC="${PUBLIRA_E2E_TENANT_DAY_INTERVAL_SEC:-2}"

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
export PUBLIRA_WEB_HOST_INTERNAL_URL="http://localhost:${PUBLIRA_E2E_WEB_HOST_PORT}"
export PUBLIRA_WEB_ADMIN_INTERNAL_URL="http://127.0.0.1:${PUBLIRA_E2E_WEB_ADMIN_PORT}"
export PUBLIRA_WEB_PLATFORM_INTERNAL_URL="http://127.0.0.1:${PUBLIRA_E2E_WEB_PLATFORM_PORT}"

# Where the worker renders its mail. Always built from the E2E port, for
# the same reason as PUBLIRA_REDIS_URL above: the isolated dev profile exports
# PUBLIRA_EMAIL_RENDERER_URL for its own renderer, so an inherited value would
# have this stack's worker render through a process it neither starts nor stops.
export PUBLIRA_EMAIL_RENDERER_URL="http://127.0.0.1:${PUBLIRA_E2E_EMAIL_RENDERER_PORT}"

# Where the platform console auth mail points. The worker builds those links, so
# without this they would name the dev stack's port instead of this run's.
export PUBLIRA_PLATFORM_APP_URL="${PUBLIRA_E2E_WEB_PLATFORM_BASE_URL}"

# Secret decryption for the SMTP password. The worker reports an unusable
# manager when it is started without keys, and every auth mail it renders stops
# at that before it reaches Mailpit. The seeded password is not an encrypted
# envelope, so the manager hands it back verbatim and the key itself is never
# used — but one has to exist. 32 bytes, base64url, as the parser requires.
export PUBLIRA_SECRET_ENCRYPTION_KEYS="${PUBLIRA_SECRET_ENCRYPTION_KEYS:-e2e:ZTJlLW9ubHktaW5zZWN1cmUtc2VjcmV0LWtleS0zMmI}"
export PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID="${PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID:-e2e}"

# Web Push. Without these the public API publishes no VAPID key and the browser
# notification switch is left out of `/settings/notifications`, so the screen
# `host.browser-notifications.spec.ts` drives would not exist. A matching P-256
# pair, because the worker validates the pair at startup and refuses to
# run on a broken one. Nothing is ever delivered through it: that spec stubs the
# Push API, so the endpoint it registers belongs to no push service.
export PUBLIRA_WEBPUSH_VAPID_PUBLIC_KEY="${PUBLIRA_WEBPUSH_VAPID_PUBLIC_KEY:-BLA9H4ThVuX8uYA1HMTOe0q51POeLNEvc-TtqSb5TKuztJM_UfKKQLLfbpm9Kr7jzikhThqoipdhx0NQgzfBDs0}"
export PUBLIRA_WEBPUSH_VAPID_PRIVATE_KEY="${PUBLIRA_WEBPUSH_VAPID_PRIVATE_KEY:-MbA3EQ7bhB1QWgq_d8DjY5bbuF616HplHhnj7yhC_Co}"
export PUBLIRA_WEBPUSH_SUBJECT="${PUBLIRA_WEBPUSH_SUBJECT:-mailto:e2e@publira.test}"

# PID files, logs, and local storage for one stack run.
#
# Concurrent stacks that override ports or COMPOSE_PROJECT_NAME must not share
# PID/log state: stop-apps would kill the other run. When PUBLIRA_E2E_RUN_DIR is unset
# and any of those knobs leave the defaults, isolate under a subdirectory named
# from the project + port numbers (same overrides → same path). Explicit
# PUBLIRA_E2E_RUN_DIR always wins. The default path e2e/.run is kept for the standard
# single-stack / CI layout so artifacts stay stable.
if [[ -n "${_E2E_RUN_DIR_FROM_ENV}" ]]; then
  export PUBLIRA_E2E_RUN_DIR="${_E2E_RUN_DIR_FROM_ENV}"
else
  _e2e_uses_default_stack=1
  if [[ "${COMPOSE_PROJECT_NAME}" != "publira-e2e" ]] ||
    [[ "${PUBLIRA_E2E_POSTGRES_PORT}" != "5433" ]] ||
    [[ "${PUBLIRA_E2E_REDIS_PORT}" != "6380" ]] ||
    [[ "${PUBLIRA_E2E_RUSTFS_PORT}" != "9003" ]] ||
    [[ "${PUBLIRA_E2E_MAILPIT_SMTP_PORT}" != "1026" ]] ||
    [[ "${PUBLIRA_E2E_MAILPIT_HTTP_PORT}" != "8026" ]] ||
    [[ "${PUBLIRA_E2E_WEB_HOST_PORT}" != "3000" ]] ||
    [[ "${PUBLIRA_E2E_WEB_ADMIN_PORT}" != "4000" ]] ||
    [[ "${PUBLIRA_E2E_WEB_PLATFORM_PORT}" != "4100" ]] ||
    [[ "${PUBLIRA_E2E_PUBLIC_API_PORT}" != "8000" ]] ||
    [[ "${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}" != "8100" ]] ||
    [[ "${PUBLIRA_E2E_WORKER_PORT}" != "8003" ]] ||
    [[ "${PUBLIRA_E2E_IMAGE_SERVER_PORT}" != "8200" ]] ||
    [[ "${PUBLIRA_E2E_EMAIL_RENDERER_PORT}" != "8300" ]] ||
    [[ "${PUBLIRA_E2E_EDGE_PORT}" != "3080" ]]; then
    _e2e_uses_default_stack=0
  fi
  if [[ "${_e2e_uses_default_stack}" -eq 1 ]]; then
    export PUBLIRA_E2E_RUN_DIR="${PUBLIRA_E2E_DIR}/.run"
  else
    # Directory name encodes the override set so start/stop/wait in one session
    # share state, while a different port set gets its own directory.
    export PUBLIRA_E2E_RUN_DIR="${PUBLIRA_E2E_DIR}/.run/${COMPOSE_PROJECT_NAME}-pg${PUBLIRA_E2E_POSTGRES_PORT}-rd${PUBLIRA_E2E_REDIS_PORT}-s3${PUBLIRA_E2E_RUSTFS_PORT}-mp${PUBLIRA_E2E_MAILPIT_SMTP_PORT}-${PUBLIRA_E2E_MAILPIT_HTTP_PORT}-h${PUBLIRA_E2E_WEB_HOST_PORT}-a${PUBLIRA_E2E_WEB_ADMIN_PORT}-p${PUBLIRA_E2E_WEB_PLATFORM_PORT}-api${PUBLIRA_E2E_PUBLIC_API_PORT}-${PUBLIRA_E2E_PUBLIC_API_GRPC_PORT}-w${PUBLIRA_E2E_WORKER_PORT}-img${PUBLIRA_E2E_IMAGE_SERVER_PORT}-er${PUBLIRA_E2E_EMAIL_RENDERER_PORT}-edge${PUBLIRA_E2E_EDGE_PORT}"
  fi
  unset _e2e_uses_default_stack
fi
unset _E2E_RUN_DIR_FROM_ENV

RUN_DIR="${PUBLIRA_E2E_RUN_DIR}"
LOG_DIR="${RUN_DIR}/logs"
PID_DIR="${RUN_DIR}/pids"
# Traefik reads its routers from a watched directory. The backend ports are
# overridable, so the file is written per run rather than committed, and
# compose mounts it through this variable.
export PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR="${RUN_DIR}/traefik"

# Lease for the compose project. Docker resources are keyed by
# COMPOSE_PROJECT_NAME, so a second stack with the same project would
# compose-down the first. A background holder keeps the lease after up.sh
# exits; only the owning PUBLIRA_E2E_RUN_DIR may release it (down.sh).
PUBLIRA_E2E_LOCK_FILE="${PUBLIRA_E2E_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lock"
PUBLIRA_E2E_LEASE_FILE="${PUBLIRA_E2E_DIR}/.run/locks/${COMPOSE_PROJECT_NAME}.lease"

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
  mkdir -p "${LOG_DIR}" "${PID_DIR}" "${PUBLIRA_E2E_TRAEFIK_DYNAMIC_DIR}"
}

is_pid_running() {
  local pid="$1"
  [[ -n "${pid}" ]] && kill -0 "${pid}" 2> /dev/null
}

# Process start time as a fingerprint to detect PID reuse (see stop_pid_file).
pid_start_time() {
  local pid="$1"
  ps -o lstart= -p "${pid}" 2> /dev/null | xargs || true
}

e2e_lease_run_dir() {
  sed -n '1p' "${PUBLIRA_E2E_LEASE_FILE}" 2> /dev/null || true
}

e2e_lease_holder_alive() {
  local pid recorded_start
  [[ -f "${PUBLIRA_E2E_LEASE_FILE}" ]] || return 1
  pid="$(sed -n '2p' "${PUBLIRA_E2E_LEASE_FILE}" 2> /dev/null || true)"
  recorded_start="$(sed -n '3p' "${PUBLIRA_E2E_LEASE_FILE}" 2> /dev/null || true)"
  is_pid_running "${pid}" || return 1
  [[ -n "${recorded_start}" && "$(pid_start_time "${pid}")" == "${recorded_start}" ]]
}

e2e_refuse_foreign_lease() {
  e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use (owned by $(e2e_lease_run_dir)); wait or set COMPOSE_PROJECT_NAME and PUBLIRA_E2E_*_PORT"
  exit 1
}

# Ownership that outlives the lease holder.
#
# The lease names its owner only while its holder process is alive, and a stack
# outlives that process easily: kill the holder, or lose it with the terminal it
# was started from, and the containers stay up with Postgres still answering on
# PUBLIRA_E2E_POSTGRES_PORT. A run that finds no lease therefore asks the stack itself
# whose it is — compose.yaml stamps PUBLIRA_E2E_RUN_DIR on every container it creates,
# and a label lives exactly as long as the container carrying it.
PUBLIRA_E2E_STACK_OWNER=""
PUBLIRA_E2E_STACK_PORT=""
PUBLIRA_E2E_STACK_PORT_PROJECT=""

# Sets PUBLIRA_E2E_STACK_OWNER to the run directory of another run's stack under this
# compose project and returns 0. The owner is empty when the containers carry no
# label at all, which is a stack these scripts did not create. Returns 1 when the
# project has no containers, or every one of them is this run's.
e2e_find_foreign_stack() {
  local run_dir
  PUBLIRA_E2E_STACK_OWNER=""
  if ! command -v docker > /dev/null 2>&1; then
    return 1
  fi
  while read -r run_dir; do
    if [[ "${run_dir}" == "${PUBLIRA_E2E_RUN_DIR}" ]]; then
      continue
    fi
    PUBLIRA_E2E_STACK_OWNER="${run_dir}"
    return 0
  done < <(docker ps --all \
    --filter "label=com.docker.compose.project=${COMPOSE_PROJECT_NAME}" \
    --format '{{.Label "com.publira.e2e.run-dir"}}' 2> /dev/null | sort -u)
  return 1
}

# Sets PUBLIRA_E2E_STACK_PORT and PUBLIRA_E2E_STACK_PORT_PROJECT to a data port of this run that
# another compose project already publishes, and returns 0. Such a stack touches
# neither this project's lease nor its containers, yet `task e2e:db` would still
# migrate and re-seed the Postgres behind PUBLIRA_E2E_POSTGRES_PORT. Only the
# containerized services are covered; the app ports belong to host processes
# docker cannot see, and start-apps.sh checks those against the listening
# sockets.
e2e_find_foreign_port_publisher() {
  local port project
  PUBLIRA_E2E_STACK_PORT=""
  PUBLIRA_E2E_STACK_PORT_PROJECT=""
  if ! command -v docker > /dev/null 2>&1; then
    return 1
  fi
  for port in \
    "${PUBLIRA_E2E_POSTGRES_PORT}" \
    "${PUBLIRA_E2E_REDIS_PORT}" \
    "${PUBLIRA_E2E_RUSTFS_PORT}" \
    "${PUBLIRA_E2E_MAILPIT_SMTP_PORT}" \
    "${PUBLIRA_E2E_MAILPIT_HTTP_PORT}"; do
    while read -r project; do
      if [[ -z "${project}" || "${project}" == "${COMPOSE_PROJECT_NAME}" ]]; then
        continue
      fi
      PUBLIRA_E2E_STACK_PORT="${port}"
      PUBLIRA_E2E_STACK_PORT_PROJECT="${project}"
      return 0
    done < <(docker ps \
      --filter "publish=${port}" \
      --format '{{.Label "com.docker.compose.project"}}' 2> /dev/null | sort -u)
  done
  return 1
}

# Refuse before anything writes: up.sh would find the other run's containers
# healthy and report success, and db-setup.sh would migrate and re-seed its
# database.
require_no_foreign_stack() {
  if e2e_find_foreign_stack; then
    if [[ -n "${PUBLIRA_E2E_STACK_OWNER}" ]]; then
      e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use (stack owned by ${PUBLIRA_E2E_STACK_OWNER}); wait or set COMPOSE_PROJECT_NAME and PUBLIRA_E2E_*_PORT"
    else
      e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use (containers these scripts did not create); remove them with 'task e2e:down', or set COMPOSE_PROJECT_NAME and PUBLIRA_E2E_*_PORT"
    fi
    exit 1
  fi
  if e2e_find_foreign_port_publisher; then
    e2e_err "port ${PUBLIRA_E2E_STACK_PORT} is published by compose project ${PUBLIRA_E2E_STACK_PORT_PROJECT}; wait or set COMPOSE_PROJECT_NAME and PUBLIRA_E2E_*_PORT"
    exit 1
  fi
}

# True while nothing holds the compose-project lock.
e2e_lock_is_free() {
  if ! command -v flock > /dev/null 2>&1; then
    return 0
  fi
  if [[ ! -e "${PUBLIRA_E2E_LOCK_FILE}" ]]; then
    return 0
  fi
  flock -n "${PUBLIRA_E2E_LOCK_FILE}" true 2> /dev/null
}

# PUBLIRA_E2E_LOCK_FILE keeps whatever path the caller reached the repository through,
# symlinks included, while /proc reports the physical one. Resolve the directory
# with `pwd -P` so the two can be compared (`readlink -f` is GNU-only).
e2e_lock_file_physical() {
  local dir
  dir="$(cd "$(dirname "${PUBLIRA_E2E_LOCK_FILE}")" 2> /dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "${dir}" "$(basename "${PUBLIRA_E2E_LOCK_FILE}")"
}

# PIDs with the lock file open, newline separated. The lease file normally
# records the holder; this is the fallback for when it is gone and the pid has
# to be recovered from the kernel instead. Linux only — elsewhere the caller
# falls back to printing a recovery hint.
e2e_lock_holder_pids() {
  local fd pid target physical
  if [[ ! -d /proc || ! -e "${PUBLIRA_E2E_LOCK_FILE}" ]]; then
    return 0
  fi
  physical="$(e2e_lock_file_physical || true)"
  physical="${physical:-${PUBLIRA_E2E_LOCK_FILE}}"
  for fd in /proc/[0-9]*/fd/*; do
    target="$(readlink "${fd}" 2> /dev/null || true)"
    if [[ "${target}" != "${PUBLIRA_E2E_LOCK_FILE}" && "${target}" != "${physical}" ]]; then
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
  printf "identify it with 'fuser %s' or 'lsof %s', then kill it" "${PUBLIRA_E2E_LOCK_FILE}" "${PUBLIRA_E2E_LOCK_FILE}"
}

# SIGTERM, then SIGKILL. Best effort: callers verify by the lock, not the pid,
# because a reaped-late zombie still answers `kill -0`.
e2e_terminate_pid() {
  local pid="$1" _
  if [[ -z "${pid}" ]]; then
    return 0
  fi
  kill "${pid}" 2> /dev/null || true
  for _ in $(seq 1 30); do
    if ! is_pid_running "${pid}"; then
      return 0
    fi
    sleep 0.1
  done
  kill -9 "${pid}" 2> /dev/null || true
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
    e2e_err "compose project ${COMPOSE_PROJECT_NAME} lock ${PUBLIRA_E2E_LOCK_FILE} is held by an unidentified process; $(e2e_lock_holder_hint)"
    return 1
  fi
  while read -r pid; do
    if [[ -z "${pid}" ]]; then
      continue
    fi
    e2e_log "reclaiming ${COMPOSE_PROJECT_NAME} lock from orphaned holder (pid ${pid})"
    e2e_terminate_pid "${pid}"
  done <<< "${pids}"
  for _ in $(seq 1 30); do
    if e2e_lock_is_free; then
      return 0
    fi
    sleep 0.1
  done
  e2e_err "compose project ${COMPOSE_PROJECT_NAME} lock ${PUBLIRA_E2E_LOCK_FILE} is still held after killing $(tr '\n' ' ' <<< "${pids}" | sed 's/ $//'); $(e2e_lock_holder_hint)"
  return 1
}

# The lock is taken but no lease names the owner: without the pid the reader
# cannot act, so print it.
e2e_report_lock_holders() {
  local pids
  pids="$(e2e_lock_holder_pids)"
  if [[ -z "${pids}" ]]; then
    e2e_err "lock ${PUBLIRA_E2E_LOCK_FILE} is held but no lease file names the owner; $(e2e_lock_holder_hint)"
    return 0
  fi
  e2e_err "lock ${PUBLIRA_E2E_LOCK_FILE} is held by pid(s) $(tr '\n' ' ' <<< "${pids}" | sed 's/ $//') with no lease file; run 'task e2e:down' to reclaim it"
}

# Detached holder so the lease outlives up.sh / start-apps.sh. Leftover-stack
# commands with the same PUBLIRA_E2E_RUN_DIR join; a different RUN_DIR is refused.
e2e_spawn_lease_holder() {
  mkdir -p "$(dirname "${PUBLIRA_E2E_LOCK_FILE}")"
  local ready pid waited
  ready="$(mktemp)"
  # Detached from the caller's stdio: the holder outlives up.sh, and keeping the
  # inherited pipe open blocks whoever reads its output until teardown.
  (
    if command -v flock > /dev/null 2>&1; then
      exec 9> "${PUBLIRA_E2E_LOCK_FILE}"
      flock -n 9 || exit 1
    fi
    printf '%s\n' "${BASHPID}" > "${ready}"
    # exec so the recorded pid *is* the process holding fd 9. A `sleep` child
    # would inherit the descriptor and keep the flock alive after the holder is
    # killed, stranding the project with no lease file to recover from.
    # The delay is ~68 years; `sleep infinity` is GNU-only.
    exec sleep 2147483647
  ) < /dev/null > /dev/null 2>&1 &
  waited=0
  while [[ ! -s "${ready}" ]]; do
    if ! kill -0 $! 2> /dev/null && [[ ! -s "${ready}" ]]; then
      rm -f "${ready}"
      e2e_err "compose project ${COMPOSE_PROJECT_NAME} is already in use; wait or set COMPOSE_PROJECT_NAME and PUBLIRA_E2E_*_PORT"
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
  printf '%s\n%s\n%s\n' "${PUBLIRA_E2E_RUN_DIR}" "${pid}" "$(pid_start_time "${pid}")" > "${PUBLIRA_E2E_LEASE_FILE}"
}

# Spawn a holder or join the existing owner. Children inherit PUBLIRA_E2E_LOCK_HELD=1
# and skip so `bash up.sh` from run.sh does not spawn a second holder.
acquire_e2e_lock() {
  if [[ "${PUBLIRA_E2E_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" == "${PUBLIRA_E2E_RUN_DIR}" ]]; then
      export PUBLIRA_E2E_LOCK_HELD=1
      return 0
    fi
    e2e_refuse_foreign_lease
  fi
  # No live lease holder says nothing about whether a stack is up, so ask the
  # containers before taking the project over for this run.
  require_no_foreign_stack
  rm -f "${PUBLIRA_E2E_LEASE_FILE}"
  e2e_spawn_lease_holder
  export PUBLIRA_E2E_LOCK_HELD=1
}

# stop-apps must not create a lease; it only refuses a foreign owner.
join_e2e_lease() {
  if [[ "${PUBLIRA_E2E_LOCK_HELD:-0}" == "1" ]]; then
    return 0
  fi
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" == "${PUBLIRA_E2E_RUN_DIR}" ]]; then
      export PUBLIRA_E2E_LOCK_HELD=1
      return 0
    fi
    e2e_refuse_foreign_lease
  fi
}

require_e2e_owner_or_free() {
  if e2e_lease_holder_alive && [[ "$(e2e_lease_run_dir)" != "${PUBLIRA_E2E_RUN_DIR}" ]]; then
    e2e_refuse_foreign_lease
  fi
}

# Owner-only. A leftover `task e2e:down` matches the lease RUN_DIR and succeeds;
# a second stack with another PUBLIRA_E2E_RUN_DIR cannot tear the first down.
release_e2e_lease() {
  local pid
  if e2e_lease_holder_alive; then
    if [[ "$(e2e_lease_run_dir)" != "${PUBLIRA_E2E_RUN_DIR}" ]]; then
      e2e_refuse_foreign_lease
    fi
    pid="$(sed -n '2p' "${PUBLIRA_E2E_LEASE_FILE}" 2> /dev/null || true)"
    e2e_terminate_pid "${pid}"
  fi
  rm -f "${PUBLIRA_E2E_LEASE_FILE}"
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
  printf '%s\n%s\n' "${pid}" "$(pid_start_time "${pid}")" > "${PID_DIR}/${name}.pid"
}

stop_pid_file() {
  local name="$1"
  local file="${PID_DIR}/${name}.pid"
  if [[ ! -f "${file}" ]]; then
    return 0
  fi
  local pid recorded_start
  pid="$(sed -n '1p' "${file}" 2> /dev/null || true)"
  recorded_start="$(sed -n '2p' "${file}" 2> /dev/null || true)"
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
  kill "${pid}" 2> /dev/null || true
  local _
  for _ in $(seq 1 30); do
    if ! is_pid_running "${pid}"; then
      break
    fi
    sleep 0.2
  done
  if is_pid_running "${pid}"; then
    e2e_log "force-killing ${name} (pid ${pid})"
    kill -9 "${pid}" 2> /dev/null || true
  fi
  rm -f "${file}"
}
