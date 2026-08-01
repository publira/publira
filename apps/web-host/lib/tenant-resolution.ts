import type { PublicApiClient } from "@publira/api-client/public/client";
import { LRUCache } from "lru-cache";

interface TenantCacheValue {
  tenantId: string | null;
}

const isNotFoundError = (error: unknown): boolean => {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as {
    code?: unknown;
    message?: unknown;
    rawMessage?: unknown;
  };

  if (candidate.code === 5 || candidate.code === "not_found") {
    return true;
  }

  if (
    typeof candidate.message === "string" &&
    candidate.message.toLowerCase().includes("not found")
  ) {
    return true;
  }

  return (
    typeof candidate.rawMessage === "string" &&
    candidate.rawMessage.toLowerCase().includes("not found")
  );
};

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

  return async (
    domainCandidates: readonly string[]
  ): Promise<string | null> => {
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
      if (isNotFoundError(error)) {
        tenantCache.set(cacheKey, { tenantId: null });
        return null;
      }

      throw error;
    }
  };
};
