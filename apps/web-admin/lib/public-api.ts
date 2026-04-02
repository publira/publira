import { createPublicApiClient } from "@publira/api-client/public/client";
import { cacheLife } from "next/cache";

const publicApiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100",
  transport: "grpc",
});

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return message.includes("not_found") || message.includes("not found");
};

export const getTenantName = async (
  tenantPublicId: string
): Promise<string | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalized = tenantPublicId.trim();
  if (!normalized) {
    return null;
  }

  try {
    const response = await publicApiClient.tenant.getTenant({
      tenant: { tenantPublicId: normalized },
    });

    return response.tenantName?.trim() || null;
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};
