import { platformApiClient } from "./platform-api-client";
import {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./platform-auth-shared";

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
    const response = await platformApiClient.auth.createSession({
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
    await platformApiClient.auth.deleteSession({}, {
      headers: { "X-Publira-Session-Id": sessionId },
    } as never);
  } catch {
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPlatformCurrentOperator = async (
  sessionId: string
): Promise<PlatformCurrentOperator | null> => {
  if (!sessionId.trim()) {
    return null;
  }
  try {
    const response = await platformApiClient.auth.getMe({}, {
      headers: { "X-Publira-Session-Id": sessionId },
    } as never);
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
