#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_e2e_owner_or_free

# shellcheck source=stop-apps.sh
# stop apps first so they release DB connections
apps_stopped=1
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/stop-apps.sh" || apps_stopped=0

e2e_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans

# Keep logs for CI artifact upload; callers may rm -rf .run if desired.
release_e2e_lease
if ((apps_stopped == 0)); then
  e2e_err "some app processes outlived teardown; their pid files are kept in ${PID_DIR} for a repeated 'task e2e:down'"
  exit 1
fi
e2e_log "stack stopped"
