import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";
import { normalizePlatformRole } from "./roles";

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("unauthenticated") ||
    message.includes("permission_denied") ||
    message.includes("invalid_argument") ||
    message.includes("not_found") ||
    message.includes("not found")
  );
};

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
    if (isExpectedNullableError(error)) {
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
      if (isExpectedNullableError(error)) {
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

export { PLATFORM_SESSION_COOKIE_NAME, sanitizeRedirectPath };
