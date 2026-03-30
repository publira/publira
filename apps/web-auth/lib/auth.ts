import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";
import {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

export interface PublicCurrentUser {
  name: string;
  publicId: string;
}

export interface SignupPublicResult {
  expiresAt?: Date;
  pendingVerification: boolean;
  sessionId?: string;
}

export const loginPublic = async (
  email: string,
  password: string,
  tenantPublicId: string
): Promise<{ expiresAt: Date; sessionId: string } | null> => {
  try {
    const response = await apiClient.auth.createSession({
      email,
      password,
      tenant: {
        tenantPublicId,
      },
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

export const signupPublic = async (
  name: string,
  email: string,
  password: string,
  tenantPublicId: string
): Promise<SignupPublicResult | null> => {
  try {
    const response = await apiClient.auth.createUser({
      email,
      name,
      password,
      tenant: {
        tenantPublicId,
      },
    });
    const { sessionId, expiresAt } = response.session ?? {};
    if (!sessionId || !expiresAt) {
      return { pendingVerification: true };
    }
    return {
      expiresAt: new Date(expiresAt),
      pendingVerification: false,
      sessionId,
    };
  } catch {
    return null;
  }
};

export const verifyPublicEmail = async (
  token: string,
  tenantPublicId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.verifyUserEmail({
      tenant: {
        tenantPublicId,
      },
      token,
    });
    return Boolean(response.verified);
  } catch {
    return false;
  }
};

export const logoutPublic = async (
  sessionId: string,
  tenantPublicId: string
): Promise<void> => {
  if (!sessionId.trim()) {
    return;
  }
  try {
    await apiClient.auth.deleteSession(
      {
        tenant: {
          tenantPublicId,
        },
      },
      buildSessionHeaders(sessionId)
    );
  } catch {
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPublicCurrentUser = async (
  tenantPublicId: string
): Promise<PublicCurrentUser | null> => {
  const sid = await resolveSessionId();
  if (!sid) {
    return null;
  }
  try {
    const response = await apiClient.auth.getMe(
      {
        tenant: {
          tenantPublicId,
        },
      },
      buildSessionHeaders(sid)
    );
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
