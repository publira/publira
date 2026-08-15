import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isExpectedNullableRpcError,
  isMissingResourceRpcError,
  isRejectedRequestRpcError,
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";

import { apiClient, withSessionHeaders } from "./api";
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

const loginFailedMessage = "メールアドレスまたはパスワードが正しくありません。";
const genericErrorMessage =
  "ログイン処理に失敗しました。時間をおいて再試行してください。";
const genericPasswordResetRequestErrorMessage =
  "再設定メールの送信に失敗しました。時間をおいて再試行してください。";
const genericPasswordResetConfirmErrorMessage =
  "パスワード再設定に失敗しました。時間をおいて再試行してください。";
const genericEmailChangeRequestErrorMessage =
  "メールアドレス変更リクエストに失敗しました。時間をおいて再試行してください。";

const toErrorMessage = (error: unknown): string =>
  rpcErrorMessage(error, genericErrorMessage, {
    // The server answers a wrong email or password with `unauthenticated`;
    // never say which of the two was wrong.
    unauthenticated: loginFailedMessage,
  });

export const loginAdmin = async (
  email: string,
  password: string,
  tenantId: string
): Promise<AdminLoginResult> => {
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
        message: genericErrorMessage,
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
      message: toErrorMessage(error),
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
): Promise<AdminCurrentUser | null> => {
  "use cache: private";

  const token = await getAccessToken();
  if (!token) {
    return null;
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
      return null;
    }

    return {
      name: response.user?.name?.trim() ?? "",
      publicId,
      role: response.user?.role?.trim() ?? "",
    };
  } catch (error) {
    if (isExpectedNullableRpcError(error)) {
      return null;
    }
    throw error;
  }
};

export const isAdminSessionValid = async (
  tenantId: string
): Promise<boolean> => {
  const user = await getAdminCurrentUser(tenantId);
  return user !== null;
};

export const sessionCookieOptions = {
  httpOnly: true,
  path: "/",
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
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
  name?: string,
  password?: string
): Promise<AcceptTenantAdminInvitationResult> => {
  const normalizedToken = token.trim();
  if (!tenantId.trim() || !normalizedToken) {
    return {
      message: "招待トークンが無効です。",
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
        "招待の承諾に失敗しました。時間をおいて再試行してください。",
        {
          "not-found": "招待が見つかりません。",
          precondition: rpcErrorHasReason(
            error,
            RPC_ERROR_REASON.invitationCanceled
          )
            ? "この招待は取り消されています。"
            : "招待リンクの有効期限が切れています。",
        }
      ),
      ok: false,
    };
  }
};

export const requestAdminPasswordReset = async (
  tenantId: string,
  email: string
): Promise<AdminPasswordResetRequestResult> => {
  const normalizedEmail = email.trim();
  if (!tenantId.trim() || !normalizedEmail) {
    return {
      message: "メールアドレスを入力してください。",
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
      message: rpcErrorMessage(error, genericPasswordResetRequestErrorMessage, {
        // Email is the only field this call takes.
        "invalid-argument": "メールアドレスを確認してください。",
      }),
      ok: false,
    };
  }
};

export const confirmAdminPasswordReset = async (
  tenantId: string,
  token: string,
  newPassword: string
): Promise<AdminPasswordResetConfirmResult> => {
  const normalizedToken = token.trim();
  const normalizedPassword = newPassword.trim();

  if (!tenantId.trim() || !normalizedToken) {
    return {
      message:
        "再設定リンクが無効です。もう一度メール送信からやり直してください。",
      ok: false,
      reason: "invalid",
    };
  }

  if (!normalizedPassword) {
    return {
      message: "新しいパスワードを入力してください。",
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
        message:
          "再設定リンクの有効期限が切れています。もう一度メール送信からやり直してください。",
        ok: false,
        reason: "expired",
      };
    }
    // An unknown token and a malformed one both mean "start over".
    if (disposition === "not-found" || disposition === "invalid-argument") {
      return {
        message:
          "再設定リンクが無効です。もう一度メール送信からやり直してください。",
        ok: false,
        reason: "invalid",
      };
    }

    return {
      message: genericPasswordResetConfirmErrorMessage,
      ok: false,
      reason: "system",
    };
  }
};

export const requestAdminEmailChange = async (
  tenantId: string,
  currentEmail: string,
  newEmail: string,
  currentPassword: string
): Promise<AdminEmailChangeRequestResult> => {
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
      message: "すべての項目を入力してください。",
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericEmailChangeRequestErrorMessage, {
        conflict: "このメールアドレスは既に使用されています。",
        "invalid-argument": rpcErrorHasFieldViolation(error, "current_password")
          ? "パスワードが正しくありません。"
          : "入力内容を確認してください。",
      }),
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
