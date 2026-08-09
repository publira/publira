import { isMissingResourceRpcError } from "@publira/api-client/errors";
import type { PublicApiClient } from "@publira/api-client/public/client";
import { LRUCache } from "lru-cache";

interface TenantCacheValue {
  tenantId: string | null;
}

export const createTenantIdResolver = (
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

  return async function resolveTenantId(
    domainCandidates: readonly string[]
  ): Promise<string | null> {
    if (domainCandidates.length === 0) {
      return null;
    }

    const cacheKey = domainCandidates.join("\0");
    const cached = tenantCache.get(cacheKey);
    if (cached !== undefined) {
      return cached.tenantId;
    }

    try {
      const response = await publicApiClient.domain.getTenantByDomain({
        domains: [...domainCandidates],
      });
      const tenantId = response.tenantId?.trim() || null;
      tenantCache.set(cacheKey, { tenantId });
      return tenantId;
    } catch (error) {
      // Only an unknown domain is cached as "no tenant"; a transient failure
      // must not pin every request on this host to 404 for the whole TTL.
      if (isMissingResourceRpcError(error)) {
        tenantCache.set(cacheKey, { tenantId: null });
        return null;
      }

      throw error;
    }
  };
};
