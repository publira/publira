#!/usr/bin/env bash
# Phase 2: run the documented setup command against the empty database and
# assert migrations landed clean and the dev seed is re-runnable.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs

bootstrap_log "=== phase 2: task setup ==="

# `task setup` = deps + mobile:deps + db:setup + server:storage-init. Without a Flutter SDK (CI hosts
# other than Test / Mobile) run the halves that do not need it; mobile deps
# are covered by the Test / Mobile job.
if command -v flutter >/dev/null 2>&1; then
  bootstrap_log "running task setup"
  (cd "${REPO_ROOT}" && task setup)
else
  bootstrap_log "flutter not found — running task setup without mobile:deps (task deps + task db:setup + task server:storage-init)"
  (cd "${REPO_ROOT}" && task deps && task db:setup && task server:storage-init)
fi

# golang-migrate stores the numeric filename prefix; compare against the
# highest migration on disk (db/AGENTS.md keeps this at the single baseline).
expected_version="$(
  find "${REPO_ROOT}/db/migrations" -name '*.up.sql' -exec basename {} \; |
    sed 's/_.*//' | sort -n | tail -n 1
)"
if [[ -z "${expected_version}" ]]; then
  bootstrap_fail "no migrations found under db/migrations"
fi
expected_version="$((10#${expected_version}))"

assert_equals "schema_migrations" "${expected_version} false" "$(migration_state)"

# The seed tenant every E2E scenario resolves by Host header.
assert_equals "seed tenant domain=localhost" "Seed Tenant" \
  "$(psql_value "SELECT name FROM tenants WHERE domain = 'localhost'")"

snapshot="$(seed_snapshot)"
bootstrap_log "seed row counts:"
sed 's/^/  /' <<<"${snapshot}"
while IFS='=' read -r table count; do
  if [[ "${count}" -lt 1 ]]; then
    bootstrap_fail "dev seed left ${table} empty"
  fi
done <<<"${snapshot}"

# Re-running the seed must neither fail nor duplicate rows (db/seeds/README.md).
bootstrap_log "re-applying the dev seed (idempotency)"
(cd "${REPO_ROOT}" && task db:seed)

reseeded="$(seed_snapshot)"
if [[ "${snapshot}" != "${reseeded}" ]]; then
  bootstrap_err "before: ${snapshot//$'\n'/ }"
  bootstrap_err "after:  ${reseeded//$'\n'/ }"
  bootstrap_fail "dev seed is not idempotent: row counts changed on re-run"
fi
bootstrap_log "ok: dev seed re-run left every row count unchanged"

# Re-running storage-init must succeed idempotently
bootstrap_log "re-applying storage-init (idempotency)"
(cd "${REPO_ROOT}" && task server:storage-init)
bootstrap_log "ok: storage-init re-run succeeded"

assert_equals "schema_migrations after re-seed" "${expected_version} false" "$(migration_state)"

bootstrap_log "phase 2 passed"
