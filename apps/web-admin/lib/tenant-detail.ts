import {
  isMissingResourceRpcError,
  isUnauthenticatedRpcError,
} from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
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

/**
 * Tag the private read of the tenant behind the console chrome carries.
 *
 * Nothing in this console clears it: the name and the domains it reports are
 * set from the platform console, which runs in another app and cannot reach
 * this one's cache, so a change there shows here once the private entry goes
 * stale. The tag is what lets an Action clear it once one writes them.
 */
export const tenantDetailCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:detail`;

const readTenantForSession = async (
  tenantId: string,
  sessionId: string
): Promise<CachedRead<GetTenantForSessionResult>> => {
  "use cache: private";

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: !sessionId };
  }

  cacheTag(tenantDetailCacheTag(normalizedTenantId));

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
      return { ok: false, requiresSignIn: false };
    }
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: false, unexpected: true };
  }
};

export const getTenantForSession = async (
  tenantId: string
): Promise<GetTenantForSessionResult> => {
  const { unexpected, ...result } = await readTenantForSession(
    tenantId,
    await getAccessToken()
  );
  if (unexpected) {
    throw new Error("The tenant could not be read.");
  }
  return result;
};
