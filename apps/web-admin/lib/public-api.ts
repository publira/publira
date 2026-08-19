import { isMissingResourceRpcError } from "@publira/api-client/errors";
import { createPublicApiClient } from "@publira/api-client/public/client";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife, cacheTag } from "next/cache";

const publicApiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100",
  transport: "grpc",
});

interface TenantPublicInfo {
  name: string | null;
  theme: TenantThemeColors;
}

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
  cacheLife("hours");

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
    if (!isMissingResourceRpcError(error)) {
      // Console chrome only — the tenant name in `<title>` and the theme
      // colours. Both are resolved before a static shell exists, where a throw
      // from a `"use cache"` fill answers a bare 500 for the whole route
      // instead of reaching any boundary (#672). The entry is dropped, so the
      // real name and theme come back as soon as the public API does.
      console.warn("[web-admin] getTenantPublicInfo failed", error);
      dropFailedCacheEntry();
    }
    return null;
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
