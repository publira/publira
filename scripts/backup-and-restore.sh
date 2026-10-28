#!/usr/bin/env bash
# backup-and-restore.sh — Take a backup of the seeded E2E stack the way
# docs/en/2-deployments/9-backup-and-restore.md tells an operator to, restore it
# into an empty PostgreSQL, bucket, and Valkey the way the same page does, and
# go through its "Verify a restore" list: the schema version, the readiness of
# every process, the storage test, and, in the `restore` Playwright group, the
# tenant console's sign-in and the tenant site's images. Before any process
# starts on the restored services, the database is compared with the backup
# restored with everything it carries, and the bucket with the one the backup
# was taken from; any difference fails the run.
#
# The lines between a `# quoted by <page>` comment and `# end of quote` are
# code blocks of that page, run as the page writes them; `pnpm docs:check`
# fails when the two differ. What the page leaves to the operator is provided
# here under the names it uses: `publiractl` is the image of this checkout,
# `pg_dump` and `pg_restore` come from the image of the stack's PostgreSQL,
# and `aws` is the AWS CLI pointed at the stack's RustFS.
#
# The stack is the E2E stack (`e2e/scripts/lib.sh`), with the processes built
# by `task e2e:build`, and is always torn down with its volumes.
#
# Inputs (env):
#   PUBLIRA_RESTORE_PUBLIRACTL_IMAGE  The publiractl image the page's commands run
#                                     (default: publira/publiractl:local, which
#                                     `task docker:build:publiractl` builds)
set -euo pipefail

# The bucket the page names; every process of the stack is pointed at it.
export PUBLIRA_S3_BUCKET=publira-images

# shellcheck source=../e2e/scripts/lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/e2e/scripts/lib.sh"

publiractl_image="${PUBLIRA_RESTORE_PUBLIRACTL_IMAGE:-publira/publiractl:local}"
if ! docker image inspect "${publiractl_image}" > /dev/null 2>&1; then
  e2e_err "the image ${publiractl_image} does not exist; run: task docker:build:publiractl"
  exit 1
fi

ensure_run_dirs
acquire_e2e_lock

work="$(mktemp -d)"
cleanup() {
  local status=$?
  bash "${PUBLIRA_E2E_SCRIPTS_DIR}/down.sh" || true
  rm -rf "${work}"
  exit "${status}"
}
trap cleanup EXIT INT TERM

# The page writes its files to the directory the commands run from.
cd "${work}"

e2e_log "=== bringing up the seeded stack ==="
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/up.sh" mailpit postgres redis rustfs traefik
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/db-setup.sh"

# pg_dump and pg_restore of the server's own major version, which the page
# asks for, from the image the stack runs the server from.
postgres_image="$(docker inspect --format '{{.Config.Image}}' "$(compose ps -q postgres)")"
pg_tool() {
  docker run --rm -i --network host --user "$(id -u):$(id -g)" \
    -v "${work}:${work}" -w "${work}" "${postgres_image}" "$@"
}
pg_dump() { pg_tool pg_dump "$@"; }
pg_restore() { pg_tool pg_restore "$@"; }

# The role passwords the stack's connection URLs carry, as the files the page
# mounts at /run/secrets. The image runs as a user of its own, which has to be
# able to read them.
secrets="${work}/secrets"
mkdir -m 755 "${secrets}"
write_password() {
  local role="$1" url="$2"
  sed -E 's|^[^:]+://[^:]*:([^@]*)@.*$|\1|' <<< "${url}" | tr -d '\n' > "${secrets}/publira-${role}-db-password"
  chmod 644 "${secrets}/publira-${role}-db-password"
}
write_password public "${PUBLIRA_PUBLIC_DB_URL}"
write_password admin "${PUBLIRA_ADMIN_DB_URL}"
write_password platform "${PUBLIRA_PLATFORM_DB_URL}"
write_password outbox "${PUBLIRA_WORKER_DB_URL}"
write_password ticker "${PUBLIRA_TICKER_DB_URL}"
write_password content-stats "${PUBLIRA_CONTENT_STATS_DB_URL}"

publiractl() {
  docker run --rm --network host \
    -e PUBLIRA_DB_URL -e PUBLIRA_PLATFORM_DB_URL \
    -e PUBLIRA_SECRET_ENCRYPTION_KEYS -e PUBLIRA_SECRET_ENCRYPTION_PRIMARY_KEY_ID \
    -e AWS_REGION -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
    -v "${secrets}:/run/secrets:ro" \
    "${publiractl_image}" "$@"
}

export AWS_ENDPOINT_URL="${PUBLIRA_S3_ENDPOINT}"

# A plain dump of a database, and every object in the bucket with its size and
# checksum. PostgreSQL 18 opens and closes a plain dump with a `\restrict` key
# drawn at random, which two dumps of the same database do not share. The
# grants on one object are printed in the order they were made, and `db roles`
# makes them in an order of its own, so each run of GRANT lines is sorted.
dump_database() {
  local url="$1"
  pg_dump --dbname="${url}" |
    grep -v '^\\\(un\)\?restrict ' |
    awk -v OFS='\t' '/^GRANT / { if (!run) run = NR; print run, $0, $0; next } { run = 0; print NR, "", $0 }' |
    LC_ALL=C sort -t "$(printf '\t')" -k1,1n -k2,2 |
    cut -f3-
}
list_objects() {
  aws s3api list-objects-v2 --bucket "${PUBLIRA_S3_BUCKET}" \
    --query 'Contents[].[Key, Size, ETag]' --output text | LC_ALL=C sort
}

e2e_log "=== taking the backup ==="
# quoted by docs/en/2-deployments/9-backup-and-restore.md
pg_dump --format=custom --file=publira.dump --dbname="$PUBLIRA_DB_URL"
publiractl db version > publira.version
# end of quote
# quoted by docs/en/2-deployments/9-backup-and-restore.md
aws s3 sync s3://publira-images publira-bucket
# end of quote
list_objects > backed-up.objects
e2e_log "backed up $(wc -l < backed-up.objects) objects at $(paste -sd ' ' publira.version)"

# What the runbook's restore has to come out as: the backup restored with all
# it carries — the owners, the grants, and every policy — into a database of
# its own beside the one it was taken from, where the roles exist. A dump of
# the database the backup was taken from would not do: PostgreSQL prints an
# expression it parsed back from a dump in a form of its own, so it differs
# from any restore in text and not in meaning.
reference_url="${PUBLIRA_DB_URL/\/publira\?//publira_reference?}"
pg_tool psql --dbname="${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -qc 'CREATE DATABASE publira_reference'
pg_restore --exit-on-error --single-transaction --dbname="${reference_url}" publira.dump
dump_database "${reference_url}" > backed-up.sql

e2e_log "=== replacing PostgreSQL, RustFS, and Valkey with empty ones ==="
compose rm --stop --force postgres rustfs redis
docker volume rm "${COMPOSE_PROJECT_NAME}_e2e-postgres-data" "${COMPOSE_PROJECT_NAME}_e2e-rustfs-data" > /dev/null
compose up -d --wait postgres rustfs redis
aws s3 mb "s3://${PUBLIRA_S3_BUCKET}" > /dev/null

e2e_log "=== restoring ==="
# quoted by docs/en/2-deployments/9-backup-and-restore.md
pg_restore --list publira.dump | grep -v ' POLICY public [^ ]* publira_rls_bypass ' > publira.list
pg_restore --no-owner --no-acl --single-transaction --use-list=publira.list --dbname="$PUBLIRA_DB_URL" publira.dump
# end of quote
# quoted by docs/en/2-deployments/9-backup-and-restore.md
publiractl db roles \
  --public-password-file /run/secrets/publira-public-db-password \
  --admin-password-file /run/secrets/publira-admin-db-password \
  --platform-password-file /run/secrets/publira-platform-db-password \
  --outbox-password-file /run/secrets/publira-outbox-db-password \
  --ticker-password-file /run/secrets/publira-ticker-db-password \
  --content-stats-password-file /run/secrets/publira-content-stats-db-password
# end of quote
# quoted by docs/en/2-deployments/9-backup-and-restore.md
aws s3 sync publira-bucket s3://publira-images
# end of quote

e2e_log "=== comparing the restore with what was backed up ==="
dump_database "${PUBLIRA_DB_URL}" > restored.sql
list_objects > restored.objects
if ! diff -u backed-up.sql restored.sql > database.diff; then
  e2e_err "the restored database differs from the one the backup was taken from:"
  cat database.diff >&2
  exit 1
fi
if ! diff -u backed-up.objects restored.objects > bucket.diff; then
  e2e_err "the restored bucket differs from the one the backup was taken from:"
  cat bucket.diff >&2
  exit 1
fi
e2e_log "ok: the database and the bucket are the ones the backup was taken from"

e2e_log "=== verifying the restore ==="
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/start-apps.sh"
# Every process answers its readiness probe.
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/wait-ready.sh"

restored_version="$(
  # quoted by docs/en/2-deployments/9-backup-and-restore.md
  publiractl db version
  # end of quote
)"
if [[ "${restored_version}" != "$(< publira.version)" ]] || ! grep -qx 'dirty false' <<< "${restored_version}"; then
  e2e_err "db version reports $(paste -sd ' ' <<< "${restored_version}"), want $(paste -sd ' ' publira.version), not dirty"
  exit 1
fi
e2e_log "ok: db version reports the version kept with the backup"

# quoted by docs/en/2-deployments/9-backup-and-restore.md
publiractl storage test
# end of quote
e2e_log "ok: storage test passes"

PUBLIRA_E2E_GROUP=restore bash "${PUBLIRA_E2E_SCRIPTS_DIR}/test.sh"
e2e_log "=== the restore is verified ==="
