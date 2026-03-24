import { apiClient, withSessionHeaders } from "./api";
import { getSessionId } from "./session";

export interface TenantDetail {
  publicId: string;
  name: string;
  domain: string;
  adminDomain: string;
}

export const getTenantForSession = async (
  tenantPublicId: string
): Promise<TenantDetail | null> => {
  "use cache: private";

  const sessionId = await getSessionId();
  const normalizedTenantPublicId = tenantPublicId.trim();
  if (!normalizedTenantPublicId || !sessionId) {
    return null;
  }

  try {
    const response = await apiClient.auth.getTenant(
      {
        sessionId,
        tenant: { tenantPublicId: normalizedTenantPublicId },
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
  } catch {
    return null;
  }
};
