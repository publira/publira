#!/usr/bin/env bash
# Shared helpers for the dev-environment bootstrap check (#514).
#
# The check runs the documented developer workflow end to end against a fresh
# Compose project and an empty Postgres volume:
#   up → task setup → DB restart → task dev → readiness of every service.
# shellcheck shell=bash

set -euo pipefail

BOOTSTRAP_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOOTSTRAP_DIR="$(cd "${BOOTSTRAP_SCRIPTS_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${BOOTSTRAP_DIR}/../.." && pwd)"

# Dedicated project name: a run never touches the Dev Container stack.
export COMPOSE_PROJECT_NAME="${BOOTSTRAP_PROJECT_NAME:-publira-bootstrap}"
ROOT_COMPOSE_FILE="${REPO_ROOT}/compose.yaml"
BOOTSTRAP_COMPOSE_FILE="${BOOTSTRAP_DIR}/compose.override.yaml"

# What `db` is expected to keep its data on. PostgreSQL 18 moved the data
# directory under a major-version subdirectory, so the volume must be mounted
# at the parent (#511); the check asserts both the mount and that PGDATA
# actually lives inside it.
EXPECTED_PGDATA_MOUNT="/var/lib/postgresql"
EXPECTED_POSTGRES_VOLUME="${COMPOSE_PROJECT_NAME}_postgres-data"
EXPECTED_RUSTFS_VOLUME="${COMPOSE_PROJECT_NAME}_rustfs-data"

# Host ports published by compose.override.yaml.
export BOOTSTRAP_POSTGRES_PORT="${BOOTSTRAP_POSTGRES_PORT:-5434}"
export BOOTSTRAP_REDIS_PORT="${BOOTSTRAP_REDIS_PORT:-6381}"
export BOOTSTRAP_RUSTFS_PORT="${BOOTSTRAP_RUSTFS_PORT:-9002}"

RUN_DIR="${BOOTSTRAP_DIR}/.run"
LOG_DIR="${RUN_DIR}/logs"
STATE_DIR="${RUN_DIR}/state"
DEV_LOG="${LOG_DIR}/task-dev.log"
DEV_PGID_FILE="${STATE_DIR}/task-dev.pgid"

# `task db:setup` reads PUBLIRA_DB_URL (db/Taskfile.yaml); the Go servers read
# one role URL each. Roles and dev passwords come from db/seeds/baseline.
export PUBLIRA_DB_URL="postgres://postgres:password@127.0.0.1:${BOOTSTRAP_POSTGRES_PORT}/publira?sslmode=disable"
export PUBLIRA_PUBLIC_DB_URL="postgres://publira_public:publicpass@127.0.0.1:${BOOTSTRAP_POSTGRES_PORT}/publira?sslmode=disable"
export PUBLIRA_ADMIN_DB_URL="postgres://publira_admin:adminpass@127.0.0.1:${BOOTSTRAP_POSTGRES_PORT}/publira?sslmode=disable"
export PUBLIRA_PLATFORM_DB_URL="postgres://publira_platform:platformpass@127.0.0.1:${BOOTSTRAP_POSTGRES_PORT}/publira?sslmode=disable"
export PUBLIRA_REDIS_URL="redis://127.0.0.1:${BOOTSTRAP_REDIS_PORT}"
# Session cookie (JWE) key for the three Next.js apps, required and without a
# fallback. `task dev` runs on the host, so the value the Dev Container's
# compose file supplies is not in scope here; export one for the check.
export PUBLIRA_AUTH_SECRET="${PUBLIRA_AUTH_SECRET:-publira-bootstrap-only-insecure-web-session-secret}"
# Access token (HS256) signing key for the Go API and image servers, required
# and without a fallback. Exported here for the same reason as the line above.
export PUBLIRA_AUTH_JWT_SECRET="${PUBLIRA_AUTH_JWT_SECRET:-publira-bootstrap-only-insecure-access-token-secret}"
export PUBLIRA_S3_BUCKET="${PUBLIRA_S3_BUCKET:-publira}"
export PUBLIRA_S3_ENDPOINT="http://127.0.0.1:${BOOTSTRAP_RUSTFS_PORT}"
export PUBLIRA_S3_FORCE_PATH_STYLE="true"
export AWS_REGION="${AWS_REGION:-us-east-1}"
export AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-publira}"
export AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-publirapass}"

# Readiness budget for `task dev` (Turbopack cold start + `go run` of five cmds).
BOOTSTRAP_DEV_TIMEOUT_SEC="${BOOTSTRAP_DEV_TIMEOUT_SEC:-600}"
BOOTSTRAP_DEV_INTERVAL_SEC="${BOOTSTRAP_DEV_INTERVAL_SEC:-2}"

# Ports `task dev` listens on. Fixed, not configurable: the Next.js apps carry
# their port in the `dev` script of each apps/*/package.json.
BOOTSTRAP_DEV_PORTS=(3000 4000 4100 8000 8001 8002 8100 8101 8102 8200 8201)

bootstrap_log() {
  printf '[bootstrap] %s\n' "$*"
}

bootstrap_err() {
  printf '[bootstrap] ERROR: %s\n' "$*" >&2
}

# Abort the run. run.sh's EXIT trap collects diagnostics.
bootstrap_fail() {
  bootstrap_err "$*"
  exit 1
}

compose() {
  docker compose \
    -f "${ROOT_COMPOSE_FILE}" \
    -f "${BOOTSTRAP_COMPOSE_FILE}" \
    -p "${COMPOSE_PROJECT_NAME}" \
    "$@"
}

ensure_run_dirs() {
  mkdir -p "${LOG_DIR}" "${STATE_DIR}"
}

db_container_id() {
  compose ps -q db 2>/dev/null || true
}

# Single-value query against the bootstrap database as the superuser.
psql_value() {
  psql "${PUBLIRA_DB_URL}" -At -v ON_ERROR_STOP=1 -c "$1"
}

# Tables the dev seed must fill; compared before/after a seed re-run and
# before/after the DB restart.
BOOTSTRAP_SEED_TABLES=(tenants tenant_config platform_users users labels series episodes)

# `<version> <dirty>` of the single golang-migrate bookkeeping row.
migration_state() {
  psql_value "SELECT version || ' ' || dirty FROM schema_migrations"
}

seed_snapshot() {
  local table
  for table in "${BOOTSTRAP_SEED_TABLES[@]}"; do
    printf '%s=%s\n' "${table}" "$(psql_value "SELECT count(*) FROM ${table}")"
  done
}

# Clients currently attached to the bootstrap Redis (includes the redis-cli
# that runs this query).
redis_connected_clients() {
  compose exec -T redis redis-cli info clients 2>/dev/null |
    tr -d '\r' | sed -n 's/^connected_clients:\([0-9]\{1,\}\)$/\1/p'
}

assert_equals() {
  local label="$1" expected="$2" actual="$3"
  if [[ "${expected}" != "${actual}" ]]; then
    bootstrap_fail "${label}: expected '${expected}', got '${actual}'"
  fi
  bootstrap_log "ok: ${label} = ${actual}"
}

# Services `task dev` must bring up: name, probe URL, expected body shape.
# `localhost` (not 127.0.0.1) for the Next.js apps so the Host header matches
# the seed tenant domain.
bootstrap_probes() {
  cat <<'EOF'
api-server/connect	http://127.0.0.1:8000/readyz	json
api-server/grpc	http://127.0.0.1:8100/readyz	json
admin-api-server/connect	http://127.0.0.1:8001/readyz	json
admin-api-server/grpc	http://127.0.0.1:8101/readyz	json
platform-api-server/connect	http://127.0.0.1:8002/readyz	json
platform-api-server/grpc	http://127.0.0.1:8102/readyz	json
image-server	http://127.0.0.1:8200/readyz	json
admin-image-server	http://127.0.0.1:8201/readyz	json
web-host/livez	http://localhost:3000/livez	text
web-host/readyz	http://localhost:3000/readyz	json
web-admin/livez	http://localhost:4000/livez	text
web-admin/readyz	http://localhost:4000/readyz	json
web-platform/livez	http://localhost:4100/livez	text
web-platform/readyz	http://localhost:4100/readyz	json
EOF
}

# Without either tool every port check would silently answer "free", turning
# the preflight and the listen assertion into no-ops.
require_port_tool() {
  command -v ss >/dev/null 2>&1 || command -v netstat >/dev/null 2>&1 ||
    bootstrap_fail "neither ss nor netstat is available; port checks cannot run"
}

port_in_use() {
  local port="$1"
  require_port_tool
  ss -ltn 2>/dev/null | grep -qE ":${port}\\b" ||
    netstat -ltn 2>/dev/null | grep -qE ":${port}\\b"
}

# Compose state + service logs, for a failed run (CI uploads LOG_DIR).
collect_diagnostics() {
  bootstrap_err "collecting diagnostics into ${LOG_DIR}"
  mkdir -p "${LOG_DIR}"

  compose ps >"${LOG_DIR}/compose-ps.log" 2>&1 || true
  compose logs --no-color --tail 200 >"${LOG_DIR}/compose.log" 2>&1 || true

  local f
  for f in "${LOG_DIR}"/*.log; do
    [[ -f "${f}" ]] || continue
    bootstrap_err "--- tail $(basename "${f}") ---"
    tail -n 40 "${f}" >&2 || true
  done
}
