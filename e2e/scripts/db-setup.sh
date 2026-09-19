#!/usr/bin/env bash
set -euo pipefail

# shellcheck source=lib.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

acquire_e2e_lock

# `task db:setup` (migrate + dev seed) against the E2E Postgres: db/Taskfile.yaml
# prefers PUBLIRA_DB_URL over the Dev Container `db` hostname, which does not
# resolve here.

e2e_log "running task db:setup against ${PUBLIRA_DB_URL}"
(cd "${REPO_ROOT}" && task db:setup)

# The dev seed names the Dev Container's `mailpit` service, a host that
# resolves neither here nor on the CI runner: every server in this stack is a
# host process and reaches mailpit on the port compose published. Rewriting the
# rows is what gives the mail-sending flows one path that behaves the same in
# both places, so a spec can read a confirmation link the database keeps only
# the hash of.
e2e_log "pointing SMTP settings at mailpit on 127.0.0.1:${PUBLIRA_E2E_MAILPIT_SMTP_PORT}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -c "
  UPDATE platform_smtp_config
  SET host = '127.0.0.1', port = ${PUBLIRA_E2E_MAILPIT_SMTP_PORT}, updated_at = NOW();
  UPDATE tenant_smtp_config
  SET host = '127.0.0.1', port = ${PUBLIRA_E2E_MAILPIT_SMTP_PORT}, updated_at = NOW();
"

# The forms that cause mail — sign-up, the resend, the password reset, the
# address change — are limited per address and per origin. A suite drives them
# far more often than a person does, and every spec reaches the servers from the
# one browser, so the built-in allowances would refuse the later cases of a run
# instead of letting them assert what they are about. The limit itself is
# covered by the Go tests; every other value here is the built-in default.
e2e_log "widening the mail-request limits of the platform policy"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -c "
  INSERT INTO platform_policy_config (
    singleton, mfa_required_for_tenant_admin,
    password_verify_limit_per_minute, password_verify_limit_per_day,
    mail_request_limit_per_address_per_hour, mail_request_limit_per_address_per_day,
    mail_request_limit_per_source_per_hour, mail_request_limit_per_source_per_day,
    comment_post_limit_per_minute, comment_post_limit_per_day,
    comment_report_limit_per_minute, comment_report_limit_per_day,
    comment_duplicate_window_minutes,
    episode_rating_limit_per_minute, episode_rating_limit_per_day,
    contact_message_limit_per_account_per_hour, contact_message_limit_per_account_per_day,
    contact_message_limit_per_client_per_hour, contact_message_limit_per_client_per_day,
    viewer_preferences_limit_per_minute, viewer_preferences_limit_per_day
  )
  VALUES (TRUE, FALSE, 5, 50, 1000, 1000, 1000, 1000, 10, 100, 10, 50, 10, 30, 300, 3, 10, 10, 30, 30, 300)
  ON CONFLICT (singleton) DO UPDATE
  SET mail_request_limit_per_address_per_hour = EXCLUDED.mail_request_limit_per_address_per_hour,
      mail_request_limit_per_address_per_day = EXCLUDED.mail_request_limit_per_address_per_day,
      mail_request_limit_per_source_per_hour = EXCLUDED.mail_request_limit_per_source_per_hour,
      mail_request_limit_per_source_per_day = EXCLUDED.mail_request_limit_per_source_per_day,
      revision = platform_policy_config.revision + 1,
      updated_at = NOW();
"

# Creates the bucket and uploads the images the development seed's rows name:
# every series' and label's eye-catch, every creator's icon, and every episode's
# body pages.
e2e_log "running task storage:seed"
(cd "${REPO_ROOT}" && task storage:seed)

# The development seed dates its catalogue and its accounts from the moment it
# runs, which a screenshot compared pixel by pixel cannot absorb. Applied here
# rather than by the screenshot specs so every suite reads the same dates the
# baseline was taken against.
screenshot_baseline_sql="${REPO_ROOT}/db/seeds/scenarios/160_screenshot_baseline.sql"
e2e_log "applying ${screenshot_baseline_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${screenshot_baseline_sql}"

# The ranking the engagement batch would have computed. Applied here for the
# same reason as the baseline above: the screenshot projects photograph the
# seeded state before any suite has applied a scenario, and the chart and the
# top page's numbered module have to be there when they do.
ranking_sql="${REPO_ROOT}/db/seeds/scenarios/170_ranking.sql"
e2e_log "applying ${ranking_sql}"
psql "${PUBLIRA_DB_URL}" -v ON_ERROR_STOP=1 -q -f "${ranking_sql}"

e2e_log "database and storage ready"
