import { platformApiClient } from "./platform-api-client";

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
    const response = await platformApiClient.operators.listOperators({}, {
      headers: { "X-Publira-Session-Id": sessionId },
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
