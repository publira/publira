#!/usr/bin/env bash
# Remove the routing-check Compose project and its volumes.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

routing_log "removing compose project ${COMPOSE_PROJECT_NAME} (containers + volumes)"
compose down -v --remove-orphans || true
routing_log "teardown complete"
