import { randomUUID } from "node:crypto";

/**
 * Host-based URL helpers for E2E.
 *
 * Every tenant host is reached on the edge, and each is stored with that port
 * (`tenantHost`): the development seed's `localhost:<edge>` and
 * `admin.localhost:<edge>`, and every scenario tenant the same way.
 */

const envUrl = (name: string, fallback: string): string => {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value.replace(/\/$/u, "") : fallback;
};

/** Public-site path under the default locale: `/series` → `/series`. */
export const hostPath = (pathname: string): string => pathname;

/**
 * Public-site path under an explicit locale prefix:
 * `("en", "/series")` → `/en/series`.
 *
 * Only a locale other than the tenant's own default is canonical this way —
 * the default is served by {@link hostPath}, and spelling it out redirects. A
 * test therefore says which locale it means rather than which tenant it is
 * talking to, and the two tenants the suite uses read the same way.
 */
export const localeHostPath = (locale: string, pathname: string): string =>
  pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;

/**
 * Public catalog site (web-host), through the E2E Traefik edge, the way a
 * deployment serves it: an episode body image is `/images/episodes/{id}` on the
 * reader's own origin, and only the edge joins web-host and the image routes
 * under one host and port. Matches the seed domain `localhost:<edge>`.
 */
export const WEB_HOST_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_BASE_URL",
  "http://localhost:3080"
);

/**
 * A tenant's stored host for `hostname`: the name on the edge's port, the one
 * port the suite reaches every tenant on.
 */
export const tenantHost = (hostname: string): string =>
  `${hostname}:${new URL(WEB_HOST_BASE_URL).port}`;

/**
 * The browser the screenshot projects render in (`e2e/browser/Dockerfile`).
 *
 * A baseline and the run comparing against it have to be rasterized by the
 * same fonts and the same Chromium, which the host machine cannot promise, so
 * those projects connect to a pinned image instead of launching a local
 * browser. Every other project keeps using the host's Playwright Chromium.
 */
export const BROWSER_WS_ENDPOINT = `${envUrl(
  "PUBLIRA_E2E_BROWSER_WS_ENDPOINT",
  "ws://127.0.0.1:3090"
)}/`;

/**
 * Mailpit's HTTP API (the `mailpit` service in `e2e/compose.yaml`).
 *
 * A confirmation token is stored hashed, so the link a flow mailed is the only
 * readable form of it: a spec that finishes such a round trip reads the message
 * back from here.
 */
export const MAILPIT_BASE_URL = envUrl(
  "PUBLIRA_E2E_MAILPIT_BASE_URL",
  "http://127.0.0.1:8026"
);

/**
 * web-host on loopback, the way the Go servers reach it.
 *
 * `WEB_HOST_BASE_URL` is a Host header the browser resolves; this is the
 * address a Node-side request can actually connect to, and it is what
 * `src/revalidate.ts` posts cache tags to.
 */
export const WEB_HOST_INTERNAL_URL = envUrl(
  "PUBLIRA_WEB_HOST_INTERNAL_URL",
  WEB_HOST_BASE_URL
);

/** Public API gRPC/Connect origin used by web-host (readyz probe target). */
export const PUBLIC_API_BASE_URL = envUrl(
  "PUBLIRA_E2E_PUBLIC_API_BASE_URL",
  "http://127.0.0.1:8100"
);

/**
 * Same web-host origin under a different Host header.
 *
 * Chromium resolves every `*.localhost` name to loopback itself (RFC 6761), so
 * no DNS entry or hosts file is needed — but only the browser does, so keep
 * these out of the Node-side `request` fixture.
 */
const withHostname = (baseUrl: string, hostname: string): string => {
  const url = new URL(baseUrl);
  url.hostname = hostname;
  return url.toString().replace(/\/$/u, "");
};

/** Tenant admin console (web-admin). Matches the seed admin domain. */
export const WEB_ADMIN_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "admin.localhost")
);

/** Platform console (web-platform). */
export const WEB_PLATFORM_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_PLATFORM_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "platform.localhost")
);

/** Second tenant from the scenario seed `db/seeds/scenarios/010_multi_tenant.sql`. */
export const WEB_HOST_OTHER_TENANT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_OTHER_TENANT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "other.localhost")
);

/**
 * Admin console of the same second tenant. Its admin comes from
 * `db/seeds/scenarios/120_admin_reporting.sql`, the one scenario that signs in
 * there: the tenant boundary of the audit log is asserted from both sides.
 */
export const WEB_ADMIN_OTHER_TENANT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_OTHER_TENANT_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.other.localhost")
);

/**
 * Inbox tenant from the scenario seed
 * `db/seeds/scenarios/060_notification_inbox.sql`.
 *
 * Its accounts exist so the empty-bell specs cannot see a publish notification
 * another spec delivered — publish fans out to every admin of the published
 * episode's tenant, and to every reader following it, its series, or one of
 * its creators.
 */
export const WEB_HOST_NOTIFICATION_INBOX_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_NOTIFICATION_INBOX_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "notify.localhost")
);

/** Admin console of the same inbox tenant. */
export const WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.notify.localhost")
);

/**
 * Public site of the delivery tenant from the scenario seed
 * `db/seeds/scenarios/180_announcement_delivery.sql`.
 *
 * Posting an announcement notifies every reader it addresses, so the tenant a
 * delivery is posted into is the opposite of the inbox tenant above: everything
 * that arrives in it arrived on purpose.
 */
export const WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_ANNOUNCEMENT_DELIVERY_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "announce.localhost")
);

/** Admin console of the same delivery tenant. */
export const WEB_ADMIN_ANNOUNCEMENT_DELIVERY_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_ANNOUNCEMENT_DELIVERY_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.announce.localhost")
);

/**
 * Public site of the banner tenant from the scenario seed
 * `db/seeds/scenarios/200_announcement_banner.sql`.
 *
 * A pinned announcement is drawn above every page of its tenant's site, so it
 * is pinned in a tenant no other spec browses.
 */
export const WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_ANNOUNCEMENT_BANNER_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "banner.localhost")
);

/** Admin console of the same banner tenant. */
export const WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_ANNOUNCEMENT_BANNER_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.banner.localhost")
);

/**
 * Admin console of the operator-settings tenant from
 * `db/seeds/scenarios/130_admin_operator_settings.sql`.
 *
 * That suite rewrites the tenant admin's address and this tenant's SMTP
 * override, so it cannot share `admin.localhost` with the suites that sign in
 * as the development seed admin or send mail through the seed tenant.
 */
export const WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.aset.localhost")
);

/**
 * Admin console of the policy tenant from
 * `db/seeds/scenarios/240_tenant_policy.sql`. Its suite rewrites tenant-wide
 * limits and retention periods, so it needs a console of its own.
 */
export const WEB_ADMIN_TENANT_POLICY_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_TENANT_POLICY_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.policy.localhost")
);

/**
 * Admin console of the mobile push tenant from
 * `db/seeds/scenarios/270_mobile_push.sql`. Its suite stores and removes the
 * tenant's Firebase credentials, so it needs a console of its own.
 */
export const WEB_ADMIN_MOBILE_PUSH_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_MOBILE_PUSH_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.mobile-push.localhost")
);

/**
 * Admin console of the payment settings tenant from
 * `db/seeds/scenarios/330_payment_settings.sql`. Its suite stores and changes
 * the tenant's payment provider credentials, so it needs a console of its own.
 */
export const WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_PAYMENT_SETTINGS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.payment.localhost")
);

/**
 * Admin console of the app links tenant from
 * `db/seeds/scenarios/280_app_links.sql`. Its suite saves and clears the apps
 * the tenant's links open in, so it needs a console of its own.
 */
export const WEB_ADMIN_APP_LINKS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_APP_LINKS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.app-links.localhost")
);

/** Public site of the same app links tenant, which serves its association documents. */
export const WEB_HOST_APP_LINKS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_APP_LINKS_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "app-links.localhost")
);

/**
 * Admin console of the sign-in providers tenant from
 * `db/seeds/scenarios/340_sign_in_providers.sql`. Its suite switches the
 * tenant's Apple and Google sign-in on and off, so it needs a console of its
 * own.
 */
export const WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_SIGN_IN_PROVIDERS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.sign-in.localhost")
);

/** Public site of the same tenant, whose tenant read names the providers offered. */
export const WEB_HOST_SIGN_IN_PROVIDERS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_SIGN_IN_PROVIDERS_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "sign-in.localhost")
);

/**
 * Admin console of the royalties tenant from
 * `db/seeds/scenarios/260_royalties.sql`. Its suite closes a month, which is
 * tenant-wide and never undone, so it needs a console of its own.
 */
export const WEB_ADMIN_ROYALTIES_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_ROYALTIES_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.royalty.localhost")
);

/**
 * Public site of the tenant that names its terms and privacy pages, from
 * `db/seeds/scenarios/300_signup_consent.sql`. The nomination is tenant-wide,
 * so the sign-up that asks for consent is not the one another suite drives.
 */
export const WEB_HOST_SIGNUP_CONSENT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_SIGNUP_CONSENT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "consent.localhost")
);

/**
 * Public site of the tenant from the same scenario that names one page as both
 * its terms of service and its privacy policy.
 */
export const WEB_HOST_SIGNUP_SHARED_CONSENT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_SIGNUP_SHARED_CONSENT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "shared-consent.localhost")
);

/**
 * Admin console of the members tenant from
 * `db/seeds/scenarios/290_tenant_members.sql`. Its suite changes who
 * administers the tenant, so it needs a console of its own.
 */
export const WEB_ADMIN_TENANT_MEMBERS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_TENANT_MEMBERS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.team.localhost")
);

/**
 * Public site of the commenting tenant from the scenario seed
 * `db/seeds/scenarios/140_episode_comments.sql`.
 *
 * `tenant_config.comment_mode` is tenant-wide, so the one tenant that takes
 * comments is not a tenant any other suite reads episode pages on.
 */
export const WEB_HOST_EPISODE_COMMENTS_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_EPISODE_COMMENTS_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "comment.localhost")
);

/**
 * Public site of the tenant whose comments wait for approval, from the
 * scenario seed `db/seeds/scenarios/150_comment_moderation.sql`.
 *
 * `tenant_config.comment_mode` is tenant-wide, so the tenant that holds
 * comments for approval cannot be the one whose comments publish immediately.
 */
export const WEB_HOST_COMMENT_MODERATION_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_COMMENT_MODERATION_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "moderate.localhost")
);

/** Admin console of the same moderation tenant. */
export const WEB_ADMIN_COMMENT_MODERATION_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_COMMENT_MODERATION_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.moderate.localhost")
);

/**
 * Public site of the tenant that makes readers prove an age, from the scenario
 * seed `db/seeds/scenarios/190_age_verification.sql`.
 *
 * `tenant_config.age_verification` is tenant-wide, so the tenant that checks
 * ages is not one whose rated series another suite opens by confirming.
 */
export const WEB_HOST_AGE_VERIFICATION_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_AGE_VERIFICATION_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "age.localhost")
);

/** Admin console of the same age-verification tenant. */
export const WEB_ADMIN_AGE_VERIFICATION_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_AGE_VERIFICATION_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.age.localhost")
);

/**
 * Public site of the Japanese-default tenant from the scenario seed
 * `db/seeds/scenarios/080_locale_switching.sql`.
 *
 * Every other seeded tenant saves `en`, so this is the only host where the
 * unprefixed URL is Japanese and `/en/...` is the one that keeps its prefix.
 */
export const WEB_HOST_JAPANESE_DEFAULT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_JAPANESE_DEFAULT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "locale.localhost")
);

/** Admin console of the same Japanese-default tenant. */
export const WEB_ADMIN_JAPANESE_DEFAULT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_ADMIN_JAPANESE_DEFAULT_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.locale.localhost")
);

/** Host that maps to no tenant at all. */
export const WEB_HOST_UNKNOWN_TENANT_BASE_URL = envUrl(
  "PUBLIRA_E2E_WEB_HOST_UNKNOWN_TENANT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "unknown-tenant.localhost")
);

/**
 * A Host that has never been resolved before, so tenant resolution has to reach
 * the public API instead of answering from web-host's in-process LRU.
 */
export const uncachedTenantBaseUrl = (): string =>
  withHostname(WEB_HOST_BASE_URL, `outage-${randomUUID()}.localhost`);
