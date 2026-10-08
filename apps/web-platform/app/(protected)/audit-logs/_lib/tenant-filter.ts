import type { GetPlatformTenantResult } from "#lib/tenants";

/**
 * The tenant filter a URL names, once the page has looked the tenant up.
 *
 * Every kind but `none` keeps the filter on screen under `label`, so the
 * operator can see it and clear it. Only `resolved` lists entries: a tenant
 * that is not there, or that could not be read, must not fall back to the
 * whole platform's log while the screen still says it is filtered.
 */
export type AuditLogTenantFilter =
  | { kind: "none" }
  | { kind: "resolved"; label: string; tenantId: string }
  | { kind: "unknown"; label: string }
  | { kind: "failed"; label: string; message: string };

export const resolveAuditLogTenantFilter = (
  tenantPublicId: string,
  result: GetPlatformTenantResult
): AuditLogTenantFilter => {
  if (!tenantPublicId) {
    return { kind: "none" };
  }
  if (!result.ok) {
    return { kind: "failed", label: tenantPublicId, message: result.message };
  }
  if (!result.tenant) {
    return { kind: "unknown", label: tenantPublicId };
  }
  return {
    kind: "resolved",
    label: result.tenant.name.trim() || tenantPublicId,
    tenantId: result.tenant.id,
  };
};
