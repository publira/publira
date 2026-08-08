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
