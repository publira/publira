#!/usr/bin/env bash
# Phase 1: bring up a fresh Compose project on an empty Postgres volume and
# assert the data directory really lives on that volume.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

bootstrap_log "=== phase 1: fresh compose project (${COMPOSE_PROJECT_NAME}) ==="

# A leftover project from an interrupted run would hide "starts from empty".
compose down -v --remove-orphans >/dev/null 2>&1 || true

if docker volume inspect "${EXPECTED_POSTGRES_VOLUME}" >/dev/null 2>&1; then
  bootstrap_fail "volume ${EXPECTED_POSTGRES_VOLUME} still exists after teardown; remove it and retry"
fi

for port in "${BOOTSTRAP_POSTGRES_PORT}" "${BOOTSTRAP_REDIS_PORT}"; do
  if port_in_use "${port}"; then
    bootstrap_fail "port ${port} is already in use; free it or override BOOTSTRAP_POSTGRES_PORT / BOOTSTRAP_REDIS_PORT"
  fi
done

bootstrap_log "starting db + redis from .devcontainer/compose.yaml"
compose up -d --wait db redis

container_id="$(db_container_id)"
if [[ -z "${container_id}" ]]; then
  bootstrap_fail "db container not found after compose up"
fi

# The volume must be mounted where PostgreSQL expects it (#511).
mounts="$(docker inspect -f '{{range .Mounts}}{{.Type}} {{.Name}} {{.Destination}}{{"\n"}}{{end}}' "${container_id}")"
expected_mount="volume ${EXPECTED_POSTGRES_VOLUME} ${EXPECTED_PGDATA_MOUNT}"
if ! grep -qxF "${expected_mount}" <<<"${mounts}"; then
  bootstrap_err "db mounts:"
  printf '%s\n' "${mounts}" >&2
  bootstrap_fail "expected mount '${expected_mount}' on the db container"
fi
bootstrap_log "ok: ${EXPECTED_POSTGRES_VOLUME} mounted at ${EXPECTED_PGDATA_MOUNT}"

# …and PGDATA must sit inside it, otherwise the data lives in the container
# layer and disappears on recreate even though the mount looks right.
data_directory="$(psql_value 'SHOW data_directory')"
if [[ "${data_directory}" != "${EXPECTED_PGDATA_MOUNT}/"* ]]; then
  bootstrap_fail "data_directory '${data_directory}' is not inside ${EXPECTED_PGDATA_MOUNT}"
fi
bootstrap_log "ok: data_directory = ${data_directory}"

if ! docker exec "${container_id}" test -s "${data_directory}/PG_VERSION"; then
  bootstrap_fail "no PG_VERSION under ${data_directory}"
fi

# Nothing has been migrated yet: this is what "empty volume" has to mean.
assert_equals "schema_migrations absent before setup" "t" \
  "$(psql_value "SELECT to_regclass('public.schema_migrations') IS NULL")"

bootstrap_log "phase 1 passed"
