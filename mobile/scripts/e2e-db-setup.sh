#!/usr/bin/env bash
# The E2E database as the mobile integration tests read it: the stack's own
# setup, then the rows only the app's live group asserts on.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "${MOBILE_DIR}/.." && pwd)"

# shellcheck source=../../e2e/scripts/lib.sh
source "${REPO_ROOT}/e2e/scripts/lib.sh"

bash "${PUBLIRA_E2E_SCRIPTS_DIR}/db-setup.sh"

# An unread announcement and notification for the seed member. Applied here
# rather than by db-setup.sh, because the Playwright suites share that script
# and read the same tenant's announcements and the same member's bell.
mobile_records_sql="${REPO_ROOT}/db/seeds/scenarios/310_mobile_reader_records.sql"
e2e_log "applying ${mobile_records_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${mobile_records_sql}"

# A reader linked to Seed Authors 001 and 002, with the tenant showing them
# their pages and two closed months. Applied here rather than by db-setup.sh,
# because the Playwright suite applies it from the spec that reads it, which
# turns the tenant's sales off and on again.
creator_pages_sql="${REPO_ROOT}/db/seeds/scenarios/730_creator_pages.sql"
e2e_log "applying ${creator_pages_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${creator_pages_sql}"

reader_mfa_sql="${REPO_ROOT}/db/seeds/scenarios/830_mobile_reader_mfa.sql"
e2e_log "applying ${reader_mfa_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${reader_mfa_sql}"
