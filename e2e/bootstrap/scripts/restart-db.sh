#!/usr/bin/env bash
# Phase 3: restart the db container and assert migration state and seed data
# survived — i.e. the volume, not the container layer, holds the data.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

bootstrap_log "=== phase 3: db restart ==="

before_migration="$(migration_state)"
before_snapshot="$(seed_snapshot)"
before_data_directory="$(psql_value 'SHOW data_directory')"

bootstrap_log "stopping db and rustfs"
compose stop db rustfs

bootstrap_log "starting db and rustfs"
compose up -d --wait db rustfs

assert_equals "data_directory after restart" "${before_data_directory}" \
  "$(psql_value 'SHOW data_directory')"
assert_equals "schema_migrations after restart" "${before_migration}" "$(migration_state)"

after_snapshot="$(seed_snapshot)"
if [[ "${before_snapshot}" != "${after_snapshot}" ]]; then
  bootstrap_err "before: ${before_snapshot//$'\n'/ }"
  bootstrap_err "after:  ${after_snapshot//$'\n'/ }"
  bootstrap_fail "seed data did not survive the db restart"
fi
bootstrap_log "ok: every seeded row count survived the restart"

# Re-running setup on an already-migrated database must stay a no-op, not a
# dirty migration.
bootstrap_log "re-running task db:setup and task server:storage-init on the restarted services"
(cd "${REPO_ROOT}" && task db:setup && task server:storage-init)
assert_equals "schema_migrations after re-setup" "${before_migration}" "$(migration_state)"

bootstrap_log "phase 3 passed"
