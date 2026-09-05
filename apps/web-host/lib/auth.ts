import {
  isExpectedNullableRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
} from "@publira/api-client/errors";
import pRetry, { AbortError } from "p-retry";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

export {
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

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
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};

/**
 * Submit a sign-up and report whether the API took it.
 *
 * An address that already has an account is accepted like a free one, so a
 * stranger cannot learn from the answer which addresses are registered. `true`
 * therefore means the request was accepted and the address was written to — not
 * that an account was created.
 */
export const signupPublic = async (
  name: string,
  email: string,
  password: string,
  tenantId: string
): Promise<boolean> => {
  try {
    const response = await apiClient.auth.createUser({
      email,
      name,
      password,
      tenant: { tenantId },
    });
    return response.accepted;
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return false;
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
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
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
    if (isRejectedRequestRpcError(error)) {
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
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
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
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
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
    // The cookie is cleared either way: an expired session and an unreachable
    // API both leave the caller with nothing worth keeping.
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isExpectedNullableRpcError(error)) {
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
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
    return false;
  }
};

/**
 * The retry below only covers "the session we just wrote is not visible to this
 * read yet", which the server reports as a missing / not-permitted record. An
 * `unauthenticated` session is a decision, not a race, so it is excluded even
 * though `isExpectedNullableRpcError` accepts it.
 */
const isStaleSessionReadError = (error: unknown): boolean =>
  isExpectedNullableRpcError(error) && !isUnauthenticatedRpcError(error);

/**
 * `p-retry` defaults to `minTimeout: 1000`, which would put up to a second onto
 * a request-path read. The wait only has to outlast the replication of a write
 * that already completed, so 100ms is used instead.
 */
const GET_ME_RETRY_MIN_TIMEOUT_MS = 100;

export const getMe = async (
  tenantId: string,
  accessToken?: string
): Promise<MeInfo | null> => {
  const sid = await resolveAccessToken(accessToken);
  if (!sid) {
    return null;
  }

  try {
    return await pRetry(
      async () => {
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
          if (isStaleSessionReadError(error)) {
            throw error;
          }
          throw new AbortError(error instanceof Error ? error : String(error));
        }
      },
      { minTimeout: GET_ME_RETRY_MIN_TIMEOUT_MS, retries: 1 }
    );
  } catch (error) {
    if (isStaleSessionReadError(error)) {
      return null;
    }
    throw error;
  }
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isRejectedRequestRpcError(error)) {
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
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    rethrowUnclassifiedRpcError(error);
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isExpectedNullableRpcError(error)) {
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
    if (isUnauthenticatedRpcError(error)) {
      throw error;
    }
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};
