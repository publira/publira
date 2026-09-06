import { randomUUID } from "node:crypto";

/**
 * Host-based URL helpers for E2E.
 *
 * Dev seed domains (db/seeds/dev/001_tenant_users.sql):
 * - public: localhost
 * - admin:  admin.localhost
 *
 * Port-bearing Host headers still resolve because getTenantDomainCandidates
 * also yields the hostname without the port.
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

/** Public catalog site (web-host). Matches seed domain `localhost`. */
export const WEB_HOST_BASE_URL = envUrl(
  "E2E_WEB_HOST_BASE_URL",
  "http://localhost:3000"
);

/**
 * The same web-host, reached through the E2E Traefik edge.
 *
 * An episode body image is `/images/episodes/{id}` on the reader's own origin,
 * and only the edge joins web-host and image-server under one host and port.
 * Suites that never load a body image keep using WEB_HOST_BASE_URL, so one
 * more hop does not sit in front of every navigation they time out on.
 *
 * It is the `viewer-performance` project's `baseURL`. A suite that reads a body
 * without being timed takes it as an absolute base instead, so it stays in the
 * ordinary chain rather than on that project's deliberately empty machine.
 */
export const WEB_HOST_EDGE_BASE_URL = envUrl(
  "E2E_WEB_HOST_EDGE_BASE_URL",
  "http://localhost:3080"
);

/** Tenant admin console (web-admin). Matches seed domain `admin.localhost`. */
export const WEB_ADMIN_BASE_URL = envUrl(
  "E2E_WEB_ADMIN_BASE_URL",
  "http://admin.localhost:4000"
);

/** Platform console (web-platform). No tenant Host resolution. */
export const WEB_PLATFORM_BASE_URL = envUrl(
  "E2E_WEB_PLATFORM_BASE_URL",
  "http://platform.localhost:4100"
);

/**
 * Mailpit's HTTP API (the `mailpit` service in `e2e/compose.yaml`).
 *
 * A confirmation token is stored hashed, so the link a flow mailed is the only
 * readable form of it: a spec that finishes such a round trip reads the message
 * back from here.
 */
export const MAILPIT_BASE_URL = envUrl(
  "E2E_MAILPIT_BASE_URL",
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
  "E2E_PUBLIC_API_BASE_URL",
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

/** Second tenant from the scenario seed `db/seeds/scenarios/010_multi_tenant.sql`. */
export const WEB_HOST_OTHER_TENANT_BASE_URL = envUrl(
  "E2E_WEB_HOST_OTHER_TENANT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "other.localhost")
);

/**
 * Admin console of the same second tenant. Its admin comes from
 * `db/seeds/scenarios/120_admin_reporting.sql`, the one scenario that signs in
 * there: the tenant boundary of the audit log is asserted from both sides.
 */
export const WEB_ADMIN_OTHER_TENANT_BASE_URL = envUrl(
  "E2E_WEB_ADMIN_OTHER_TENANT_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.other.localhost")
);

/**
 * Inbox tenant from the scenario seed
 * `db/seeds/scenarios/060_notification_inbox.sql`.
 *
 * Its accounts exist so the empty-bell specs cannot see a publish notification
 * another spec delivered — publish fans out to every member and admin of the
 * published episode's tenant.
 */
export const WEB_HOST_NOTIFICATION_INBOX_BASE_URL = envUrl(
  "E2E_WEB_HOST_NOTIFICATION_INBOX_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "notify.localhost")
);

/** Admin console of the same inbox tenant. */
export const WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL = envUrl(
  "E2E_WEB_ADMIN_NOTIFICATION_INBOX_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.notify.localhost")
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
  "E2E_WEB_ADMIN_OPERATOR_SETTINGS_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.aset.localhost")
);

/**
 * Public site of the commenting tenant from the scenario seed
 * `db/seeds/scenarios/140_episode_comments.sql`.
 *
 * `tenant_config.comment_mode` is tenant-wide, so the one tenant that takes
 * comments is not a tenant any other suite reads episode pages on.
 */
export const WEB_HOST_EPISODE_COMMENTS_BASE_URL = envUrl(
  "E2E_WEB_HOST_EPISODE_COMMENTS_BASE_URL",
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
  "E2E_WEB_HOST_COMMENT_MODERATION_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "moderate.localhost")
);

/** Admin console of the same moderation tenant. */
export const WEB_ADMIN_COMMENT_MODERATION_BASE_URL = envUrl(
  "E2E_WEB_ADMIN_COMMENT_MODERATION_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.moderate.localhost")
);

/**
 * Public site of the Japanese-default tenant from the scenario seed
 * `db/seeds/scenarios/080_locale_switching.sql`.
 *
 * Every other seeded tenant saves `en`, so this is the only host where the
 * unprefixed URL is Japanese and `/en/...` is the one that keeps its prefix.
 */
export const WEB_HOST_JAPANESE_DEFAULT_BASE_URL = envUrl(
  "E2E_WEB_HOST_JAPANESE_DEFAULT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "locale.localhost")
);

/** Admin console of the same Japanese-default tenant. */
export const WEB_ADMIN_JAPANESE_DEFAULT_BASE_URL = envUrl(
  "E2E_WEB_ADMIN_JAPANESE_DEFAULT_BASE_URL",
  withHostname(WEB_ADMIN_BASE_URL, "admin.locale.localhost")
);

/** Host that maps to no tenant at all. */
export const WEB_HOST_UNKNOWN_TENANT_BASE_URL = envUrl(
  "E2E_WEB_HOST_UNKNOWN_TENANT_BASE_URL",
  withHostname(WEB_HOST_BASE_URL, "unknown-tenant.localhost")
);

/**
 * A Host that has never been resolved before, so tenant resolution has to reach
 * the public API instead of answering from web-host's in-process LRU.
 */
export const uncachedTenantBaseUrl = (): string =>
  withHostname(WEB_HOST_BASE_URL, `outage-${randomUUID()}.localhost`);
