import {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./platform-auth-shared";

export interface PlatformCurrentOperator {
  name: string;
  publicId: string;
  role: string;
}

const defaultOperator: PlatformCurrentOperator = {
  name: process.env.PUBLIRA_PLATFORM_OPERATOR_NAME ?? "Platform Operator",
  publicId: process.env.PUBLIRA_PLATFORM_OPERATOR_PUBLIC_ID ?? "operator_demo",
  role: process.env.PUBLIRA_PLATFORM_OPERATOR_ROLE ?? "platform_operator",
};

export const loginPlatform = (
  email: string,
  password: string
): { expiresAt: Date; sessionId: string } | null => {
  if (!email.trim() || !password) {
    return null;
  }

  return {
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 12),
    sessionId: `platform-${crypto.randomUUID()}`,
  };
};

export const logoutPlatform = (sessionId: string): string => sessionId.trim();

export const getPlatformCurrentOperator = (
  sessionId: string
): PlatformCurrentOperator | null => {
  if (!sessionId.trim()) {
    return null;
  }

  return defaultOperator;
};

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
};

export { PLATFORM_SESSION_COOKIE_NAME, sanitizeRedirectPath };
