import { apiClient, buildSessionHeaders, resolveSessionId } from "./api-client";

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

  const sessionId = await resolveSessionId();
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
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("invalid credentials") ||
        message.includes("unauthenticated")
      ) {
        return { message: "パスワードが正しくありません。", ok: false };
      }
      if (
        message.includes("invalid_argument") ||
        message.includes("invalid email") ||
        message.includes("required")
      ) {
        return { message: "入力内容を確認してください。", ok: false };
      }
      if (message.includes("already_exists")) {
        return {
          message: "このメールアドレスは既に使用されています。",
          ok: false,
        };
      }
    }

    return { message: genericErrorMessage, ok: false };
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
  } catch {
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
  } catch {
    return null;
  }
};
