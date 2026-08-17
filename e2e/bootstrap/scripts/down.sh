#!/usr/bin/env bash
# Tear the bootstrap check down: dev processes first (they hold DB
# connections), then the Compose project and its volumes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

bash "${BOOTSTRAP_SCRIPTS_DIR}/dev-down.sh" || true

bootstrap_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans || true

# Logs stay for CI artifact upload; the storage scratch dir does not.
rm -rf "${PUBLIRA_LOCAL_STORAGE_DIR}"

bootstrap_log "teardown complete"
