#!/usr/bin/env bash
# Phase 3: restart the db and rustfs containers and assert migration state,
# seed data, and stored objects survived — i.e. the volumes, not the container
# layers, hold the data.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

bootstrap_log "=== phase 3: db restart ==="

before_migration="$(migration_state)"
before_snapshot="$(seed_snapshot)"
before_data_directory="$(psql_value 'SHOW data_directory')"

# Storage side of the same question: the rustfs volume, not the container
# layer, must hold the objects. A bucket alone proves nothing here — the
# storage-init re-run below would recreate an empty one — so write a sentinel
# object first and read it back before anything touches the bucket again.
sentinel_key="bootstrap/restart-sentinel.txt"
sentinel_value="restart-sentinel-$(date +%s)-$$"
sentinel_file="${STATE_DIR}/rustfs-sentinel.txt"
printf '%s\n' "${sentinel_value}" >"${sentinel_file}"
bootstrap_log "storing rustfs sentinel object s3://${PUBLIRA_S3_BUCKET}/${sentinel_key}"
aws s3 cp "${sentinel_file}" "s3://${PUBLIRA_S3_BUCKET}/${sentinel_key}" \
  --endpoint-url "${PUBLIRA_S3_ENDPOINT}" >/dev/null

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

if ! aws s3api head-bucket --bucket "${PUBLIRA_S3_BUCKET}" --endpoint-url "${PUBLIRA_S3_ENDPOINT}" 2>/dev/null; then
  bootstrap_fail "bucket ${PUBLIRA_S3_BUCKET} did not survive the rustfs restart"
fi
restored_file="${STATE_DIR}/rustfs-sentinel-restored.txt"
if ! aws s3 cp "s3://${PUBLIRA_S3_BUCKET}/${sentinel_key}" "${restored_file}" \
  --endpoint-url "${PUBLIRA_S3_ENDPOINT}" >/dev/null 2>&1; then
  bootstrap_fail "sentinel object ${sentinel_key} did not survive the rustfs restart"
fi
assert_equals "rustfs sentinel object after restart" "${sentinel_value}" \
  "$(cat "${restored_file}")"

# Re-running setup on an already-migrated database must stay a no-op, not a
# dirty migration.
bootstrap_log "re-running task db:setup and task storage:init on the restarted services"
(cd "${REPO_ROOT}" && task db:setup && task storage:init)
assert_equals "schema_migrations after re-setup" "${before_migration}" "$(migration_state)"

bootstrap_log "phase 3 passed"
