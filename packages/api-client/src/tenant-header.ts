import type { Interceptor } from "@connectrpc/connect";

const TENANT_PUBLIC_ID_HEADER = "X-Publira-Tenant-Public-Id";

export type TenantHeaderValueResolver = string | (() => string | undefined);

export interface TenantHeaderOptions {
  tenantPublicId?: TenantHeaderValueResolver;
}

const resolveTenantPublicId = (
  tenantPublicId?: TenantHeaderValueResolver
): string | undefined => {
  if (typeof tenantPublicId === "function") {
    return tenantPublicId();
  }
  return tenantPublicId;
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

const inferTenantPublicIdFromMessage = (
  message: unknown
): string | undefined => {
  const root = asRecord(message);
  if (!root) {
    return undefined;
  }

  const topLevelTenantPublicId =
    readStringProp(root, "tenantPublicId") ||
    readStringProp(root, "tenant_public_id");
  if (topLevelTenantPublicId) {
    return topLevelTenantPublicId;
  }

  const tenant = asRecord(root.tenant);
  if (!tenant) {
    return undefined;
  }
  const tenantPublicId =
    readStringProp(tenant, "tenantPublicId") ||
    readStringProp(tenant, "tenant_public_id");
  return tenantPublicId || undefined;
};

export const createTenantHeaderInterceptor =
  (options: TenantHeaderOptions): Interceptor | undefined =>
  (next) =>
  async (req) => {
    if (req.header.get(TENANT_PUBLIC_ID_HEADER)?.trim()) {
      return await next(req);
    }

    const tenantPublicId = (
      resolveTenantPublicId(options.tenantPublicId) ??
      inferTenantPublicIdFromMessage(req.message)
    )?.trim();

    if (tenantPublicId) {
      req.header.set(TENANT_PUBLIC_ID_HEADER, tenantPublicId);
    }
    return await next(req);
  };
