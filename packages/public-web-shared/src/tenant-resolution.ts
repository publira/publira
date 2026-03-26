import type { PublicApiClient } from "@publira/api-client/public/client";
import { LRUCache } from "lru-cache";

interface TenantCacheValue {
  tenantPublicId: string | null;
}

export const createTenantPublicIdResolver = (
  publicApiClient: PublicApiClient,
  options?: {
    max?: number;
    ttl?: number;
  }
) => {
  const tenantCache = new LRUCache<string, TenantCacheValue>({
    max: options?.max ?? 500,
    ttl: options?.ttl ?? 300_000,
  });

  return async (
    domainCandidates: readonly string[]
  ): Promise<string | null> => {
    if (domainCandidates.length === 0) {
      return null;
    }

    const cacheKey = domainCandidates.join("\0");
    const cached = tenantCache.get(cacheKey);
    if (cached !== undefined) {
      return cached.tenantPublicId;
    }

    try {
      const response = await publicApiClient.auth.getTenantByDomain({
        domains: [...domainCandidates],
      });
      const tenantPublicId = response.tenantPublicId?.trim() || null;
      tenantCache.set(cacheKey, { tenantPublicId });
      return tenantPublicId;
    } catch {
      return null;
    }
  };
};
