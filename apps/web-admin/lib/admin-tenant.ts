import { createAdminApiClient } from "@publira/api-client/admin/client";
import { LRUCache } from "lru-cache";

const adminApiClient = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_ADMIN_API_BASE_URL ?? "http://localhost:8001",
});

const tenantCache = new LRUCache<string, { tenantPublicId: string | null }>({
  max: 500,
  ttl: 300_000,
});

export const resolveAdminTenantPublicId = async (
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
    const response = await adminApiClient.auth.getTenantByDomain({
      domains: [...domainCandidates],
    });
    const tenantPublicId = response.tenantPublicId?.trim() || null;
    tenantCache.set(cacheKey, { tenantPublicId });
    return tenantPublicId;
  } catch {
    tenantCache.set(cacheKey, { tenantPublicId: null });
    return null;
  }
};
