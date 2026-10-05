#!/usr/bin/env bash
# The stack the live group of the integration tests reads: the E2E containers
# it uses, the database and storage as e2e-db-setup.sh leaves them, and the
# server and the worker from server/bin, already built.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=../../e2e/scripts/lib.sh
source "${REPO_ROOT}/e2e/scripts/lib.sh"

# The app talks to the server directly and opens no web app, so neither the
# edge nor the browser is started. mailpit takes the mail the worker sends
# for a sign-up and a password reset.
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/up.sh" postgres redis rustfs mailpit
bash "${MOBILE_DIR}/scripts/e2e-db-setup.sh"
# The one process answers the API and the images. Every seeded episode
# carries a body, so the reader fetches its pages as soon as a test opens one,
# and an unanswered fetch fails the run from outside the test that caused it.
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/server.sh" start-wait
# A sign-up only records the request, and the worker is what opens the account.
bash "${PUBLIRA_E2E_SCRIPTS_DIR}/worker.sh" start-wait
