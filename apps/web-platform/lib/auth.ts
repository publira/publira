import {
  isExpectedNullableRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
} from "@publira/api-client/errors";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { normalizePlatformRole } from "./roles";

export {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

export interface PlatformCurrentOperator {
  name: string;
  publicId: string;
  role: string;
}

/**
 * The signed-in operator, or why they could not be read.
 *
 * `requiresSignIn` separates a session the API rejected from a `GetMe` that
 * answered nothing useful. Both used to arrive as `null`, and only the first is
 * a reason to send the operator through login again.
 */
export type GetPlatformCurrentOperatorResult =
  | { ok: true; operator: PlatformCurrentOperator }
  | { ok: false; requiresSignIn: boolean };

export const loginPlatform = async (
  email: string,
  password: string
): Promise<{ accessToken: string; expiresAt: Date } | null> => {
  try {
    const response = await apiClient.auth.login({
      email,
      password,
    });
    const { token: accessToken, expiresAt } = response.accessToken ?? {};
    if (!accessToken || !expiresAt) {
      return null;
    }
    return { accessToken, expiresAt: new Date(expiresAt) };
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const logoutPlatform = async (accessToken: string): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }
  try {
    await apiClient.auth.logout({}, buildSessionHeaders(accessToken));
  } catch {
    // The cookie is cleared either way: an expired session and an unreachable
    // API both leave the caller with nothing worth keeping.
  }
};

export const getPlatformCurrentOperator =
  async (): Promise<GetPlatformCurrentOperatorResult> => {
    "use cache: private";

    const sid = await resolveAccessToken();
    if (!sid) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    try {
      const response = await apiClient.auth.getMe({}, buildSessionHeaders(sid));
      const { user } = response;
      if (!user) {
        return { ok: false, requiresSignIn: false };
      }
      return {
        ok: true,
        operator: {
          name: user.name,
          publicId: user.publicId,
          role: normalizePlatformRole(user.role),
        },
      };
    } catch (error) {
      if (isUnauthenticatedRpcError(error)) {
        // A rejected session must not be cached, or the console would keep
        // redirecting to /login after the operator has signed in again.
        dropFailedCacheEntry();
        return { ok: false, requiresSignIn: true };
      }
      if (isExpectedNullableRpcError(error)) {
        return { ok: false, requiresSignIn: false };
      }
      throw error;
    }
  };
