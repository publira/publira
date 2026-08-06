import { createPublicApiClient } from "@publira/api-client/public/client";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife, cacheTag } from "next/cache";

export type { TenantThemeColors } from "@publira/utils/theme-css-variables";

const publicApiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100",
  transport: "grpc",
});

interface TenantPublicInfo {
  name: string | null;
  theme: TenantThemeColors;
}

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("not_found") || message.includes("not found");
};

const applyTenantSiteCacheTag = (tenantId: string) => {
  try {
    cacheTag(`tenant:${tenantId}:site`);
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};

const getTenantPublicInfo = async (
  tenantId: string
): Promise<TenantPublicInfo | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalized = tenantId.trim();
  if (!normalized) {
    return null;
  }

  applyTenantSiteCacheTag(normalized);

  try {
    const response = await publicApiClient.tenant.getTenant({
      tenant: { tenantId: normalized },
    });

    return {
      name: response.tenantName?.trim() || null,
      theme: resolveTenantThemeColors(response.theme),
    };
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const getTenantName = async (
  tenantId: string
): Promise<string | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.name ?? null;
};

export const getTenantThemeColors = async (
  tenantId: string
): Promise<TenantThemeColors | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return info?.theme ?? null;
};
