import { test as setup } from "@playwright/test";

import { applyScenarioSql } from "../src/db";
import {
  platformAuditLogsTag,
  platformDashboardTag,
  platformEndUsersTag,
  platformNotificationsTag,
  platformOperatorsTag,
  platformTenantsTag,
  revalidatePlatformTags,
} from "../src/revalidate";
import { ADMIN_ANALYTICS_SCENARIO } from "../src/scenarios/admin-analytics";
import { ADMIN_MFA_SETTINGS_SCENARIO } from "../src/scenarios/admin-mfa-settings";
import { ANNOUNCEMENT_BANNER_SCENARIO } from "../src/scenarios/announcement-banner";
import { COMMENT_MODERATION_SCENARIO } from "../src/scenarios/comment-moderation";
import { CONTACT_WORKFLOW_SCENARIO } from "../src/scenarios/contact-workflow";
import { DOCS_GOOGLE_TAG_SCENARIO } from "../src/scenarios/docs-google-tag";
import { DOCS_SUBSCRIPTION_PLANS_SCENARIO } from "../src/scenarios/docs-subscription-plans";
import { ROYALTIES_SCENARIO } from "../src/scenarios/royalties";
import { SIGN_IN_PROVIDERS_SCENARIO } from "../src/scenarios/sign-in-providers";
import { STOREFRONT_SUBSCRIPTIONS_SCENARIO } from "../src/scenarios/storefront-subscriptions";

/**
 * The state the documentation's screenshots show that the development seed
 * does not hold, written once before any of them is taken.
 *
 * Most of it lives on the tenants other suites own, which are applied here as
 * those suites apply them, and the `<nnn>_docs_*` files add to them what only
 * the documentation needs: comments in every state, episodes waiting to be
 * published, announcements, invitations, a closed royalty statement, the
 * Platform Console's own tenants, operators, and records, campaign banners in
 * every standing, a Google tag saved in the gateway mode, subscription plans
 * in both states, one with a subscriber, and a week of sign-ups followed for
 * the cohorts. Applying every
 * file once, rather than from the specs that read them, is what lets those
 * specs run beside one another: a spec applying a file again deletes rows
 * another spec may be photographing at that moment. Nothing is reverted
 * afterwards, since each suite that owns one of these tenants applies its file
 * again before it runs.
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
  "470_docs_platform",
  "560_docs_campaign_banners",
  DOCS_GOOGLE_TAG_SCENARIO,
  STOREFRONT_SUBSCRIPTIONS_SCENARIO,
  DOCS_SUBSCRIPTION_PLANS_SCENARIO,
  ADMIN_ANALYTICS_SCENARIO,
] as const;

setup("the scenario tenants the documentation's screenshots show", async () => {
  for (const scenario of SCENARIOS) {
    applyScenarioSql(scenario);
  }
  // The Platform Console holds its lists for minutes, and the baseline project
  // before this one has already read the tenants and the dashboard; the rows
  // written straight to Postgres above reach it only once those are dropped.
  await revalidatePlatformTags([
    platformAuditLogsTag,
    platformDashboardTag,
    platformEndUsersTag,
    platformNotificationsTag,
    platformOperatorsTag,
    platformTenantsTag,
  ]);
});
