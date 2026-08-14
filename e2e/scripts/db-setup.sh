#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

acquire_e2e_lock

# `task db:setup` (migrate + dev seed) against the E2E Postgres: db/Tafkfile.yaml
# prefers PUBLIRA_DB_URL over the Dev Container `db` hostname, which does not
# resolve here.

e2e_log "running task db:setup against ${PUBLIRA_DB_URL}"
(cd "${REPO_ROOT}" && task db:setup)

e2e_log "database ready"
