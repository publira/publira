#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# shellcheck source=stop-apps.sh
# stop apps first so they release DB connections
bash "${E2E_SCRIPTS_DIR}/stop-apps.sh" || true

e2e_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans || true

# Keep logs for CI artifact upload; callers may rm -rf .run if desired.
e2e_log "stack stopped"
