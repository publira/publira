#!/usr/bin/env bash
# Tear the bootstrap check down: dev processes first (they hold DB
# connections), then the Compose project and its volumes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

bash "${BOOTSTRAP_SCRIPTS_DIR}/dev-down.sh" || true

bootstrap_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans || true

bootstrap_log "teardown complete"
