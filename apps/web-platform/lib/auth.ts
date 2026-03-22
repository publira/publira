import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";
import {
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
): Promise<{ expiresAt: Date; sessionId: string } | null> => {
  try {
    const response = await apiClient.auth.createSession({
      email,
      password,
    });
    const { sessionId, expiresAt } = response.session ?? {};
    if (!sessionId || !expiresAt) {
      return null;
    }
    return { expiresAt: new Date(expiresAt), sessionId };
  } catch {
    return null;
  }
};

export const logoutPlatform = async (sessionId: string): Promise<void> => {
  if (!sessionId.trim()) {
    return;
  }
  try {
    await apiClient.auth.deleteSession({}, buildSessionHeaders(sessionId));
  } catch {
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPlatformCurrentOperator =
  async (): Promise<PlatformCurrentOperator | null> => {
    const sid = await resolveSessionId();
    if (!sid) {
      return null;
    }
    try {
      const response = await apiClient.auth.getMe({}, buildSessionHeaders(sid));
      const { user } = response;
      if (!user) {
        return null;
      }
      return { name: user.name, publicId: user.publicId, role: user.role };
    } catch {
      return null;
    }
  };

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export { PLATFORM_SESSION_COOKIE_NAME, sanitizeRedirectPath };
