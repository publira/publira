import {
  isMissingResourceRpcError,
  isUnauthenticatedRpcError,
} from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import { apiClient, withSessionHeaders } from "./api";
import { getAccessToken } from "./session";

export interface TenantDetail {
  publicId: string;
  name: string;
  domain: string;
  adminDomain: string;
}

/**
 * The tenant behind the console chrome, or why it could not be read.
 *
 * `requiresSignIn` is what separates "this session is over" from "this tenant
 * is not visible": both used to arrive as `null`, and the layout sent the
 * operator to `/login` either way. Only the first should clear the cookie and
 * say so on the login form.
 */
export type GetTenantForSessionResult =
  | { ok: true; tenant: TenantDetail }
  | { ok: false; requiresSignIn: boolean };

const readTenantForSession = async (
  tenantId: string,
  sessionId: string
): Promise<GetTenantForSessionResult> => {
  "use cache: private";

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: !sessionId };
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
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: false };
    }

    return {
      ok: true,
      tenant: {
        adminDomain: response.tenant?.adminDomain?.trim() ?? "",
        domain: response.tenant?.domain?.trim() ?? "",
        name,
        publicId,
      },
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    if (isMissingResourceRpcError(error)) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: false };
    }
    throw error;
  }
};

export const getTenantForSession = async (
  tenantId: string
): Promise<GetTenantForSessionResult> =>
  readTenantForSession(tenantId, await getAccessToken());
