import type { Interceptor } from "@connectrpc/connect";

/** Internal tenant primary key (UUID) header. */
const TENANT_ID_HEADER = "X-Publira-Tenant-Id";

export type TenantHeaderValueResolver = string | (() => string | undefined);

export interface TenantHeaderOptions {
  /** Tenant primary key (UUID). Prefer this over embedding in every message. */
  tenantId?: TenantHeaderValueResolver;
}

const isString = (value: unknown): value is string => typeof value === "string";

const isFixedTenantId = (
  tenantId: TenantHeaderValueResolver
): tenantId is string => typeof tenantId === "string";

const resolveTenantId = (
  tenantId?: TenantHeaderValueResolver
): string | undefined =>
  tenantId === undefined || isFixedTenantId(tenantId) ? tenantId : tenantId();

/**
 * The fields a request message may name its tenant's primary key in, read
 * without knowing which message it is.
 */
interface TenantIdFields {
  readonly tenant?: unknown;
  readonly tenantId?: unknown;
  readonly tenant_id?: unknown;
}

const hasTenantIdFields = (value: unknown): value is TenantIdFields =>
  typeof value === "object" && value !== null;

const tenantIdOf = ({
  tenantId,
  tenant_id: snakeCaseTenantId,
}: TenantIdFields): string =>
  (isString(tenantId) ? tenantId.trim() : "") ||
  (isString(snakeCaseTenantId) ? snakeCaseTenantId.trim() : "");

const inferTenantIdFromMessage = (
  message: TenantIdFields
): string | undefined => {
  const topLevel = tenantIdOf(message);

  if (topLevel) {
    return topLevel;
  }

  if (!hasTenantIdFields(message.tenant)) {
    return undefined;
  }

  return tenantIdOf(message.tenant) || undefined;
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
      (hasTenantIdFields(req.message)
        ? inferTenantIdFromMessage(req.message)
        : undefined)
    )?.trim();

    if (tenantId) {
      req.header.set(TENANT_ID_HEADER, tenantId);
    }

    return await next(req);
  };
