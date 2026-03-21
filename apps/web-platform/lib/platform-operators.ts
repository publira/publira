import { createPlatformApiClient } from "@publira/api-client/platform/client";

const platformApiBaseUrl =
  process.env.PUBLIRA_PLATFORM_API_BASE_URL ?? "http://localhost:8002";

const platformApiClient = createPlatformApiClient({
  baseUrl: platformApiBaseUrl,
});

export interface PlatformOperatorSummary {
  createdAt: string;
  email: string;
  name: string;
  publicId: string;
  role: string;
  status: string;
}

export const listPlatformOperators = async (
  sessionId: string
): Promise<PlatformOperatorSummary[]> => {
  if (!sessionId.trim()) {
    return [];
  }

  try {
    const response = await platformApiClient.operators.listOperators({
      sessionId,
    } as never);
    return (response.operators ?? []).map((operator) => ({
      createdAt: operator.createdAt,
      email: operator.email,
      name: operator.name,
      publicId: operator.publicId,
      role: operator.role,
      status: operator.status,
    }));
  } catch {
    return [];
  }
};
