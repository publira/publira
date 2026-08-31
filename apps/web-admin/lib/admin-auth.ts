import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { loadAdminMessages } from "./locale";
import type { AdminMessages } from "./locale";
import { getAccessToken } from "./session";

export {
  ADMIN_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./admin-auth-shared";

export type AdminLoginResult =
  | {
      ok: true;
      accessToken: string;
      expiresAt: Date;
    }
  | {
      ok: false;
      message: string;
    };

export interface AdminCurrentUser {
  name: string;
  publicId: string;
  role: string;
}

/**
 * The signed-in operator, or why they could not be read.
 *
 * `requiresSignIn` separates a session the API rejected from a `GetMe` that
 * answered nothing useful. Both used to arrive as `null`, and only the first is
 * a reason to send the operator through login again.
 */
export type GetAdminCurrentUserResult =
  | { ok: true; user: AdminCurrentUser }
  | { ok: false; requiresSignIn: boolean };

export interface TenantAdminInvitationState {
  accountExists: boolean;
  email: string;
  expiresAt: string;
  status: string;
}

export type AcceptTenantAdminInvitationResult =
  | {
      ok: true;
      accountCreated: boolean;
      accepted: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type AdminPasswordResetRequestResult =
  | {
      ok: true;
      requested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type AdminPasswordResetConfirmResult =
  | {
      ok: true;
      confirmed: boolean;
    }
  | {
      ok: false;
      message: string;
      reason: "expired" | "invalid" | "system";
    };

export type AdminEmailChangeRequestResult =
  | {
      ok: true;
      requested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export interface AdminEmailChangeConfirmResult {
  confirmed: boolean;
  changed: boolean;
  pendingConfirmationFor: string;
}

export const isTenantAdminRole = (role: string | null | undefined): boolean => {
  const normalizedRole = role?.trim().toLowerCase();
  return normalizedRole === "admin" || normalizedRole === "tenant_admin";
};

const toErrorMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const messages = await loadAdminMessages(locale);

  return rpcErrorMessage(
    error,
    getMessage(messages, "admin.auth.errors.login_processing_failed"),
    {
      // The server answers a wrong email or password with `unauthenticated`;
      // never say which of the two was wrong.
      locale,
      overrides: {
        unauthenticated: getMessage(messages, "admin.auth.errors.login_failed"),
      },
    }
  );
};

const genericEmailChangeRequestErrorMessage = (
  messages: AdminMessages
): string => getMessage(messages, "admin.settings.email_change.failed");

export const loginAdmin = async (
  email: string,
  password: string,
  tenantId: string,
  locale: Locale
): Promise<AdminLoginResult> => {
  const messages = await loadAdminMessages(locale);
  try {
    const response = await apiClient.auth.login({
      email,
      password,
      tenant: { tenantId },
    });

    const accessToken = response.accessToken?.token?.trim() ?? "";
    const expiresAtRaw = response.accessToken?.expiresAt ?? "";
    const expiresAt = new Date(expiresAtRaw);

    if (!accessToken || Number.isNaN(expiresAt.getTime())) {
      return {
        message: getMessage(
          messages,
          "admin.auth.errors.login_processing_failed"
        ),
        ok: false,
      };
    }

    return {
      accessToken,
      expiresAt,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: await toErrorMessage(error, locale),
      ok: false,
    };
  }
};

export const logoutAdmin = async (
  accessToken: string,
  tenantId: string
): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }

  await apiClient.auth.logout(
    { tenant: { tenantId } },
    withSessionHeaders(accessToken)
  );
};

export const getAdminCurrentUser = async (
  tenantId: string
): Promise<GetAdminCurrentUserResult> => {
  "use cache: private";

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, requiresSignIn: true };
  }

  try {
    const response = await apiClient.auth.getMe(
      {
        tenant: { tenantId },
      },
      withSessionHeaders(token)
    );

    const publicId = response.user?.publicId?.trim() ?? "";
    if (!publicId) {
      return { ok: false, requiresSignIn: false };
    }

    return {
      ok: true,
      user: {
        name: response.user?.name?.trim() ?? "",
        publicId,
        role: response.user?.role?.trim() ?? "",
      },
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return { ok: false, requiresSignIn: true };
    }
    if (isExpectedNullableRpcError(error)) {
      return { ok: false, requiresSignIn: false };
    }
    throw error;
  }
};

export const isAdminSessionValid = async (
  tenantId: string
): Promise<boolean> => {
  const result = await getAdminCurrentUser(tenantId);
  return result.ok;
};

export const getTenantAdminInvitationState = async (
  tenantId: string,
  token: string
): Promise<TenantAdminInvitationState | null> => {
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return null;
  }

  try {
    const response = await apiClient.auth.getTenantAdminInvitationState({
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      accountExists: response.accountExists,
      email: response.email,
      expiresAt: response.expiresAt,
      status: response.status,
    };
  } catch (error) {
    // No session header is sent here — the invitation link is followed while
    // logged out. `unauthenticated` would therefore mean the auth wiring or the
    // API contract broke, not that the invitation is unknown, so it must not be
    // flattened into "no such invitation".
    if (isMissingResourceRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const acceptTenantAdminInvitation = async (
  tenantId: string,
  token: string,
  locale: Locale,
  name?: string,
  password?: string
): Promise<AcceptTenantAdminInvitationResult> => {
  const messages = await loadAdminMessages(locale);
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return {
      message: getMessage(messages, "admin.auth.accept_invite.invalid_token"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.acceptTenantAdminInvitation({
      name: name?.trim() ?? "",
      password: password?.trim() ?? "",
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      accepted: response.accepted,
      accountCreated: response.accountCreated,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "admin.auth.errors.accept_invite_failed"),
        {
          locale,
          overrides: {
            "not-found": getMessage(
              messages,
              "admin.auth.accept_invite.not_found"
            ),
            precondition: rpcErrorHasReason(
              error,
              RPC_ERROR_REASON.invitationCanceled
            )
              ? getMessage(messages, "admin.auth.accept_invite.canceled")
              : getMessage(messages, "admin.auth.accept_invite.expired_action"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const requestAdminPasswordReset = async (
  tenantId: string,
  email: string,
  locale: Locale
): Promise<AdminPasswordResetRequestResult> => {
  const messages = await loadAdminMessages(locale);
  const normalizedEmail = email.trim();
  if (!tenantId.trim() || !normalizedEmail) {
    return {
      message: getMessage(messages, "admin.auth.fields.email_required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestPasswordReset({
      email: normalizedEmail,
      tenant: { tenantId },
    });

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "admin.auth.errors.reset_request_failed"),
        {
          locale,
          overrides: {
            // Email is the only field this call takes.
            "invalid-argument": getMessage(
              messages,
              "admin.auth.errors.reset_request_invalid_email"
            ),
          },
        }
      ),
      ok: false,
    };
  }
};

export const confirmAdminPasswordReset = async (
  tenantId: string,
  token: string,
  newPassword: string,
  locale: Locale
): Promise<AdminPasswordResetConfirmResult> => {
  const normalizedToken = token.trim();
  const normalizedPassword = newPassword.trim();
  const messages = await loadAdminMessages(locale);

  if (!tenantId.trim() || !normalizedToken) {
    return {
      message: getMessage(messages, "admin.auth.errors.reset_link_invalid"),
      ok: false,
      reason: "invalid",
    };
  }

  if (!normalizedPassword) {
    return {
      message: getMessage(messages, "admin.auth.errors.new_password_required"),
      ok: false,
      reason: "system",
    };
  }

  try {
    const response = await apiClient.auth.confirmPasswordReset({
      newPassword: normalizedPassword,
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      confirmed: response.confirmed,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const disposition = rpcErrorDisposition(error);
    if (disposition === "precondition") {
      return {
        message: getMessage(messages, "admin.auth.errors.reset_link_expired"),
        ok: false,
        reason: "expired",
      };
    }
    // An unknown token and a malformed one both mean "start over".
    if (disposition === "not-found" || disposition === "invalid-argument") {
      return {
        message: getMessage(messages, "admin.auth.errors.reset_link_invalid"),
        ok: false,
        reason: "invalid",
      };
    }

    return {
      message: getMessage(messages, "admin.auth.errors.reset_confirm_failed"),
      ok: false,
      reason: "system",
    };
  }
};

export const requestAdminEmailChange = async (
  tenantId: string,
  currentEmail: string,
  newEmail: string,
  currentPassword: string,
  locale: Locale
): Promise<AdminEmailChangeRequestResult> => {
  const messages = await loadAdminMessages(locale);
  const normalizedCurrentEmail = currentEmail.trim();
  const normalizedNewEmail = newEmail.trim();

  const sessionId = await getAccessToken();
  if (
    !tenantId.trim() ||
    !sessionId.trim() ||
    !normalizedCurrentEmail ||
    !normalizedNewEmail ||
    !currentPassword
  ) {
    return {
      message: getMessage(
        messages,
        "admin.settings.email_change.all_fields_required"
      ),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail: normalizedCurrentEmail,
        currentPassword,
        newEmail: normalizedNewEmail,
        tenant: { tenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        genericEmailChangeRequestErrorMessage(messages),
        {
          locale,
          overrides: {
            conflict: getMessage(
              messages,
              "admin.settings.email_change.email_taken"
            ),
            "invalid-argument": rpcErrorHasFieldViolation(
              error,
              "current_password"
            )
              ? getMessage(
                  messages,
                  "admin.settings.email_change.password_incorrect"
                )
              : getMessage(messages, "errors.validation"),
          },
        }
      ),
      ok: false,
    };
  }
};

export const confirmAdminEmailChange = async (
  tenantId: string,
  token: string
): Promise<AdminEmailChangeConfirmResult | null> => {
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return null;
  }

  try {
    const response = await apiClient.auth.confirmEmailChange({
      tenant: { tenantId },
      token: normalizedToken,
    });

    return {
      changed: response.changed,
      confirmed: response.confirmed,
      pendingConfirmationFor: response.pendingConfirmationFor,
    };
  } catch (error) {
    // The page renders `null` as "this link is expired or invalid", so only a
    // rejected token may resolve to it. A transport failure or a broken server
    // must not be presented to the operator as a dead link.
    if (isRejectedRequestRpcError(error)) {
      return null;
    }
    throw error;
  }
};
