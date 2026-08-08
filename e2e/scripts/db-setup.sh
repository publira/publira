#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# Call migrate/psql directly so we never hit the Dev Container `db` hostname
# (Task's db:setup defaults to postgres://…@db:5432 and var overrides are brittle
# when MIGRATE embeds DB_URL at parse time).

migrations_dir="${REPO_ROOT}/db/migrations"
seed_file="${REPO_ROOT}/db/seeds/dev.sql"

e2e_log "applying migrations via ${PUBLIRA_DB_URL}"
migrate -path "${migrations_dir}" -database "${PUBLIRA_DB_URL}" up

e2e_log "applying dev seed"
# seeds/dev.sql uses \ir relative to its directory
(
  cd "${REPO_ROOT}/db/seeds"
  psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -f dev.sql
)

e2e_log "database ready"
