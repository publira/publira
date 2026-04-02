import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";
import {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

const isExpectedNullableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("unauthenticated") ||
    message.includes("permission_denied") ||
    message.includes("invalid_argument") ||
    message.includes("already_exists") ||
    message.includes("not_found") ||
    message.includes("not found")
  );
};

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
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
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
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
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

export const confirmPublicEmailChange = async (
  token: string,
  tenantPublicId: string
): Promise<{
  changed: boolean;
  confirmed: boolean;
  pendingConfirmationFor: string;
} | null> => {
  try {
    const response = await apiClient.auth.confirmEmailChange({
      tenant: {
        tenantPublicId,
      },
      token,
    });
    return {
      changed: Boolean(response.changed),
      confirmed: Boolean(response.confirmed),
      pendingConfirmationFor: response.pendingConfirmationFor,
    };
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const requestPublicPasswordReset = async (
  email: string,
  tenantPublicId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.requestPasswordReset({
      email,
      tenant: {
        tenantPublicId,
      },
    });
    return Boolean(response.requested);
  } catch {
    return false;
  }
};

export const confirmPublicPasswordReset = async (
  token: string,
  newPassword: string,
  tenantPublicId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.confirmPasswordReset({
      newPassword,
      tenant: {
        tenantPublicId,
      },
      token,
    });
    return Boolean(response.confirmed);
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

export { PUBLIC_SESSION_COOKIE_NAME, sanitizeRedirectPath };
