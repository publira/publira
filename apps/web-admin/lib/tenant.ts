import { LRUCache } from "lru-cache";

import { apiClient } from "./api";

const tenantCache = new LRUCache<string, { tenantPublicId: string | null }>({
  max: 500,
  ttl: 300_000,
});

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

export const resolveTenantPublicId = async (
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
    const response = await apiClient.auth.getTenantByDomain({
      domains: [...domainCandidates],
    });
    const tenantPublicId = response.tenantPublicId?.trim() || null;
    tenantCache.set(cacheKey, { tenantPublicId });
    return tenantPublicId;
  } catch (error) {
    if (isNotFoundError(error)) {
      tenantCache.set(cacheKey, { tenantPublicId: null });
      return null;
    }

    throw error;
  }
};
