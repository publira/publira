import {
  isExpectedNullableRpcError,
  isRejectedRequestRpcError,
} from "@publira/api-client/errors";

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
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPlatformCurrentOperator =
  async (): Promise<PlatformCurrentOperator | null> => {
    "use cache: private";

    const sid = await resolveAccessToken();
    if (!sid) {
      return null;
    }
    try {
      const response = await apiClient.auth.getMe({}, buildSessionHeaders(sid));
      const { user } = response;
      if (!user) {
        return null;
      }
      return {
        name: user.name,
        publicId: user.publicId,
        role: normalizePlatformRole(user.role),
      };
    } catch (error) {
      if (isExpectedNullableRpcError(error)) {
        return null;
      }
      throw error;
    }
  };

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};
