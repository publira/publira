#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ensure_run_dirs
e2e_log "starting compose project ${COMPOSE_PROJECT_NAME}"
compose up -d --wait
e2e_log "compose dependencies are up"
