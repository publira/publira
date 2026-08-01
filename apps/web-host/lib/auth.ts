import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
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

export interface MeInfo {
  name: string;
  publicId: string;
  role: string;
}

export interface NotificationSettings {
  emailNotificationsEnabled: boolean;
}

export interface SignupPublicResult {
  accessToken?: string;
  expiresAt?: Date;
  pendingVerification: boolean;
}

export const loginPublic = async (
  email: string,
  password: string,
  tenantId: string
): Promise<{ accessToken: string; expiresAt: Date } | null> => {
  try {
    const response = await apiClient.auth.login({
      email,
      password,
      tenant: { tenantId },
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

export const signupPublic = async (
  name: string,
  email: string,
  password: string,
  tenantId: string
): Promise<SignupPublicResult | null> => {
  try {
    const response = await apiClient.auth.createUser({
      email,
      name,
      password,
      tenant: { tenantId },
    });
    const { token: accessToken, expiresAt } = response.accessToken ?? {};
    if (!accessToken || !expiresAt) {
      return { pendingVerification: true };
    }
    return {
      accessToken,
      expiresAt: new Date(expiresAt),
      pendingVerification: false,
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
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.verifyUserEmail({
      tenant: { tenantId },
      token,
    });
    return Boolean(response.verified);
  } catch {
    return false;
  }
};

export const confirmPublicEmailChange = async (
  token: string,
  tenantId: string
): Promise<{
  changed: boolean;
  confirmed: boolean;
  pendingConfirmationFor: string;
} | null> => {
  try {
    const response = await apiClient.auth.confirmEmailChange({
      tenant: { tenantId },
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
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.requestPasswordReset({
      email,
      tenant: { tenantId },
    });
    return Boolean(response.requested);
  } catch {
    return false;
  }
};

export const confirmPublicPasswordReset = async (
  token: string,
  newPassword: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.confirmPasswordReset({
      newPassword,
      tenant: { tenantId },
      token,
    });
    return Boolean(response.confirmed);
  } catch {
    return false;
  }
};

export const logoutPublic = async (
  accessToken: string,
  tenantId: string
): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }
  try {
    await apiClient.auth.logout(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(accessToken)
    );
  } catch {
    // セッション失効・ネットワークエラー時もクッキーはクリアする
  }
};

export const getPublicCurrentUser = async (
  tenantId: string
): Promise<PublicCurrentUser | null> => {
  const sid = await resolveAccessToken();
  if (!sid) {
    return null;
  }
  try {
    const response = await apiClient.auth.getMe(
      {
        tenant: { tenantId },
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

export const requestPublicEmailChange = async (
  tenantId: string,
  currentEmail: string,
  newEmail: string,
  currentPassword: string,
  accessToken?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return false;
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail,
        currentPassword,
        newEmail,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return Boolean(response.requested);
  } catch {
    return false;
  }
};

export const getMe = async (
  tenantId: string,
  accessToken?: string
): Promise<MeInfo | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await apiClient.auth.getMe(
        {
          tenant: { tenantId },
        },
        buildSessionHeaders(sid)
      );

      if (!response.user) {
        return null;
      }

      return {
        name: response.user.name,
        publicId: response.user.publicId,
        role: response.user.role,
      };
    } catch (error) {
      if (!isExpectedNullableError(error)) {
        throw error;
      }
      if (attempt === 1) {
        return null;
      }
    }
  }

  return null;
};

export const updateMe = async (
  tenantId: string,
  name: string,
  accessToken?: string
): Promise<MeInfo | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateMe(
      {
        name,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    if (!response.user) {
      return null;
    }

    return {
      name: response.user.name,
      publicId: response.user.publicId,
      role: response.user.role,
    };
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const deleteMe = async (
  tenantId: string,
  password: string,
  accessToken?: string
): Promise<boolean> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return false;
  }

  try {
    await apiClient.auth.deleteMe(
      {
        password,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return true;
  } catch {
    return false;
  }
};

export const getNotificationSettings = async (
  tenantId: string,
  accessToken?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.getNotificationSettings(
      {
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
    };
  } catch (error) {
    if (isExpectedNullableError(error)) {
      return null;
    }
    throw error;
  }
};

export const updateNotificationSettings = async (
  tenantId: string,
  emailNotificationsEnabled: boolean,
  accessToken?: string
): Promise<NotificationSettings | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    const response = await apiClient.auth.updateNotificationSettings(
      {
        emailNotificationsEnabled,
        tenant: { tenantId },
      },
      buildSessionHeaders(sid)
    );

    return {
      emailNotificationsEnabled: response.emailNotificationsEnabled,
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
