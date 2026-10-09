import { test as setup } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import { ADMIN_MFA_SETTINGS_SCENARIO } from "../src/scenarios/admin-mfa-settings";
import { ANNOUNCEMENT_BANNER_SCENARIO } from "../src/scenarios/announcement-banner";
import { COMMENT_MODERATION_SCENARIO } from "../src/scenarios/comment-moderation";
import { CONTACT_WORKFLOW_SCENARIO } from "../src/scenarios/contact-workflow";
import { ROYALTIES_SCENARIO } from "../src/scenarios/royalties";
import { SIGN_IN_PROVIDERS_SCENARIO } from "../src/scenarios/sign-in-providers";

/**
 * The state the documentation's screenshots show that the development seed
 * does not hold, written once before any of them is taken.
 *
 * Most of it lives on the tenants other suites own, which are applied here as
 * those suites apply them, and the `4n0_docs_*` files add to them what only
 * the documentation needs: comments in every state, episodes waiting to be
 * published, announcements, invitations, and a closed royalty statement. Applying every file once, rather
 * than from the specs that read them, is what lets those specs run beside one
 * another: a spec applying a file again deletes rows another spec may be
 * photographing at that moment. Nothing is reverted afterwards, since each
 * suite that owns one of these tenants applies its file again before it runs.
 */
const SCENARIOS = [
  COMMENT_MODERATION_SCENARIO,
  "420_docs_comments",
  "450_docs_publishing",
  ANNOUNCEMENT_BANNER_SCENARIO,
  "430_docs_announcements",
  "440_docs_members",
  ROYALTIES_SCENARIO,
  "460_docs_royalties",
  SIGN_IN_PROVIDERS_SCENARIO,
  ADMIN_MFA_SETTINGS_SCENARIO,
  CONTACT_WORKFLOW_SCENARIO,
] as const;

setup("the scenario tenants the documentation's screenshots show", () => {
  for (const scenario of SCENARIOS) {
    applyScenarioSql(scenario);
  }
});
