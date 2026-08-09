#!/usr/bin/env bash
# Playwright only — the stack must already be up (see run.sh for the full
# lifecycle).
#
# Sources lib.sh so a standalone `task e2e:test` gets the same environment as a
# full run: scenario SQL needs PUBLIRA_DB_URL, and the outage scenario shells
# out to api-server.sh with the E2E_* ports.
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

cd "${E2E_DIR}"
exec pnpm exec playwright test "$@"
