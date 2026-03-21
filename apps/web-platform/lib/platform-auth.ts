import { createPlatformApiClient } from "@publira/api-client/platform/client";

import {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./platform-auth-shared";

const platformApiBaseUrl =
  process.env.PUBLIRA_PLATFORM_API_BASE_URL ?? "http://localhost:8002";

const platformApiClient = createPlatformApiClient({
  baseUrl: platformApiBaseUrl,
});

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
    await platformApiClient.auth.deleteSession({ sessionId });
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
    const response = await platformApiClient.auth.getMe({ sessionId });
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
