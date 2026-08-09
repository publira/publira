import { isExpectedNullableRpcError } from "@publira/api-client/errors";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export interface TenantDetail {
  publicId: string;
  name: string;
  domain: string;
  adminDomain: string;
}

export const getTenantForSession = async (
  tenantId: string
): Promise<TenantDetail | null> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return null;
  }

  try {
    const response = await apiClient.auth.getTenant(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    const publicId = response.tenant?.publicId?.trim() ?? "";
    const name = response.tenant?.name?.trim() ?? "";
    if (!publicId || !name) {
      return null;
    }

    return {
      adminDomain: response.tenant?.adminDomain?.trim() ?? "",
      domain: response.tenant?.domain?.trim() ?? "",
      name,
      publicId,
    };
  } catch (error) {
    if (isExpectedNullableRpcError(error)) {
      return null;
    }
    throw error;
  }
};
