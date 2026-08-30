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

/** Public catalog site (web-host). Matches seed domain `localhost`. */
export const WEB_HOST_BASE_URL = envUrl(
  "E2E_WEB_HOST_BASE_URL",
  "http://localhost:3000"
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
