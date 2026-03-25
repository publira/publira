import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";
import {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

export interface PublicCurrentUser {
  name: string;
  publicId: string;
}

export const loginPublic = async (
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

export const logoutPublic = async (sessionId: string): Promise<void> => {
  if (!sessionId.trim()) {
    return;
  }
  try {
    await apiClient.auth.deleteSession({}, buildSessionHeaders(sessionId));
  } catch {
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPublicCurrentUser =
  async (): Promise<PublicCurrentUser | null> => {
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
      return {
        name: user.name,
        publicId: user.publicId,
      };
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

export { PUBLIC_SESSION_COOKIE_NAME, sanitizeRedirectPath };
