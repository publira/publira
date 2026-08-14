#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

require_e2e_owner_or_free

# shellcheck source=stop-apps.sh
# stop apps first so they release DB connections
bash "${E2E_SCRIPTS_DIR}/stop-apps.sh" || true

e2e_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans

# Keep logs for CI artifact upload; callers may rm -rf .run if desired.
release_e2e_lease
e2e_log "stack stopped"
