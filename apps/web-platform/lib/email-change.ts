import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";

const genericErrorMessage =
  "メールアドレスの変更リクエストに失敗しました。しばらくしてからもう一度お試しください。";

export type EmailChangeRequestResult =
  | { message: string; ok: false }
  | { ok: true; requested: boolean };

export const requestPlatformEmailChange = async (
  currentEmail: string,
  newEmail: string,
  currentPassword: string
): Promise<EmailChangeRequestResult> => {
  const normalizedCurrentEmail = currentEmail.trim();
  const normalizedNewEmail = newEmail.trim();

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再度ログインしてください。",
      ok: false,
    };
  }

  if (!normalizedCurrentEmail || !normalizedNewEmail || !currentPassword) {
    return { message: "すべての項目を入力してください。", ok: false };
  }

  try {
    const response = await apiClient.auth.requestEmailChange(
      {
        currentEmail: normalizedCurrentEmail,
        currentPassword,
        newEmail: normalizedNewEmail,
      },
      buildSessionHeaders(sessionId)
    );

    return { ok: true, requested: response.requested };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, genericErrorMessage, {
        conflict: "このメールアドレスは既に使用されています。",
        "invalid-argument": rpcErrorHasFieldViolation(error, "current_password")
          ? "パスワードが正しくありません。"
          : "入力内容を確認してください。",
      }),
      ok: false,
    };
  }
};

export interface EmailChangeTokenVerifyResult {
  valid: boolean;
}

export const verifyPlatformEmailChangeToken = async (
  token: string
): Promise<EmailChangeTokenVerifyResult | null> => {
  try {
    const response = await apiClient.auth.verifyEmailChangeToken({ token });
    return { valid: response.valid };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};

export interface EmailChangeConfirmResult {
  changed: boolean;
  confirmed: boolean;
  pendingConfirmationFor: string;
}

export const confirmPlatformEmailChange = async (
  token: string
): Promise<EmailChangeConfirmResult | null> => {
  try {
    const response = await apiClient.auth.confirmEmailChange({ token });
    return {
      changed: response.changed,
      confirmed: response.confirmed,
      pendingConfirmationFor: response.pendingConfirmationFor,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    return null;
  }
};
