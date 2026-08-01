import type { Interceptor } from "@connectrpc/connect";

/** Internal tenant primary key (UUID) header. */
const TENANT_ID_HEADER = "X-Publira-Tenant-Id";

export type TenantHeaderValueResolver = string | (() => string | undefined);

export interface TenantHeaderOptions {
  /** Tenant primary key (UUID). Prefer this over embedding in every message. */
  tenantId?: TenantHeaderValueResolver;
  /**
   * @deprecated Use tenantId. Accepted for temporary compatibility.
   */
  tenantPublicId?: TenantHeaderValueResolver;
}

const resolveTenantId = (
  tenantId?: TenantHeaderValueResolver
): string | undefined => {
  if (typeof tenantId === "function") {
    return tenantId();
  }
  return tenantId;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as Record<string, unknown>;
};

const readStringProp = (
  record: Record<string, unknown>,
  key: string
): string => {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
};

const inferTenantIdFromMessage = (message: unknown): string | undefined => {
  const root = asRecord(message);
  if (!root) {
    return undefined;
  }

  const topLevel =
    readStringProp(root, "tenantId") ||
    readStringProp(root, "tenant_id") ||
    readStringProp(root, "tenantPublicId") ||
    readStringProp(root, "tenant_public_id");
  if (topLevel) {
    return topLevel;
  }

  const tenant = asRecord(root.tenant);
  if (!tenant) {
    return undefined;
  }
  const tenantId =
    readStringProp(tenant, "tenantId") ||
    readStringProp(tenant, "tenant_id") ||
    readStringProp(tenant, "tenantPublicId") ||
    readStringProp(tenant, "tenant_public_id");
  return tenantId || undefined;
};

export const createTenantHeaderInterceptor =
  (options: TenantHeaderOptions): Interceptor | undefined =>
  (next) =>
  async (req) => {
    if (req.header.get(TENANT_ID_HEADER)?.trim()) {
      return await next(req);
    }

    const tenantId = (
      resolveTenantId(options.tenantId) ??
      resolveTenantId(options.tenantPublicId) ??
      inferTenantIdFromMessage(req.message)
    )?.trim();

    if (tenantId) {
      req.header.set(TENANT_ID_HEADER, tenantId);
    }
    return await next(req);
  };
