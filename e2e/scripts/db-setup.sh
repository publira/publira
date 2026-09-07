#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

acquire_e2e_lock

# `task db:setup` (migrate + dev seed) against the E2E Postgres: db/Taskfile.yaml
# prefers PUBLIRA_DB_URL over the Dev Container `db` hostname, which does not
# resolve here.

e2e_log "running task db:setup against ${PUBLIRA_DB_URL}"
(cd "${REPO_ROOT}" && task db:setup)

# The dev seed names the Dev Container's `mailpit` service, a host that
# resolves neither here nor on the CI runner: every server in this stack is a
# host process and reaches mailpit on the port compose published. Rewriting the
# rows is what gives the mail-sending flows one path that behaves the same in
# both places, so a spec can read a confirmation link the database keeps only
# the hash of.
e2e_log "pointing SMTP settings at mailpit on 127.0.0.1:${E2E_MAILPIT_SMTP_PORT}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -c "
  UPDATE platform_smtp_config
  SET host = '127.0.0.1', port = ${E2E_MAILPIT_SMTP_PORT}, updated_at = NOW();
  UPDATE tenant_smtp_config
  SET host = '127.0.0.1', port = ${E2E_MAILPIT_SMTP_PORT}, updated_at = NOW();
"

e2e_log "running task storage:init"
(cd "${REPO_ROOT}" && task storage:init)

# After storage:init: the fixtures need the bucket to exist.
bash "${E2E_SCRIPTS_DIR}/seed-viewer-pages.sh"

# The development seed dates its catalogue and its accounts from the moment it
# runs, which a screenshot compared pixel by pixel cannot absorb. Applied here
# rather than by the screenshot specs so every suite reads the same dates the
# baseline was taken against.
screenshot_baseline_sql="${REPO_ROOT}/db/seeds/scenarios/160_screenshot_baseline.sql"
e2e_log "applying ${screenshot_baseline_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${screenshot_baseline_sql}"

e2e_log "database and storage ready"
