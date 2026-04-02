import { apiClient } from "./api-client";

const genericPasswordResetRequestErrorMessage =
  "再設定メールの送信に失敗しました。時間をおいて再試行してください。";
const genericPasswordResetConfirmErrorMessage =
  "パスワード再設定に失敗しました。時間をおいて再試行してください。";

export type PlatformPasswordResetRequestResult =
  | {
      ok: true;
      requested: boolean;
    }
  | {
      ok: false;
      message: string;
    };

export type PlatformPasswordResetConfirmResult =
  | {
      ok: true;
      confirmed: boolean;
    }
  | {
      ok: false;
      message: string;
      reason: "expired" | "invalid" | "system";
    };

export const requestPlatformPasswordReset = async (
  email: string
): Promise<PlatformPasswordResetRequestResult> => {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    return {
      message: "メールアドレスを入力してください。",
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestPasswordReset({
      email: normalizedEmail,
    });

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("invalid_argument") ||
        message.includes("invalid email") ||
        message.includes("required")
      ) {
        return {
          message: "メールアドレスを確認してください。",
          ok: false,
        };
      }
    }

    return {
      message: genericPasswordResetRequestErrorMessage,
      ok: false,
    };
  }
};

export const verifyPlatformPasswordResetToken = async (
  token: string
): Promise<boolean> => {
  const normalizedToken = token.trim();
  if (!normalizedToken) {
    return false;
  }

  try {
    const response = await apiClient.auth.verifyPasswordResetToken({
      token: normalizedToken,
    });
    return response.valid;
  } catch {
    return false;
  }
};

export const confirmPlatformPasswordReset = async (
  token: string,
  newPassword: string
): Promise<PlatformPasswordResetConfirmResult> => {
  const normalizedToken = token.trim();
  const normalizedPassword = newPassword.trim();

  if (!normalizedToken) {
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
      token: normalizedToken,
    });

    return {
      confirmed: response.confirmed,
      ok: true,
    };
  } catch (error) {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      if (
        message.includes("failed_precondition") ||
        message.includes("expired")
      ) {
        return {
          message:
            "再設定リンクの有効期限が切れています。もう一度メール送信からやり直してください。",
          ok: false,
          reason: "expired",
        };
      }
      if (
        message.includes("not_found") ||
        message.includes("invalid_argument") ||
        message.includes("required") ||
        message.includes("user not found")
      ) {
        return {
          message:
            "再設定リンクが無効です。もう一度メール送信からやり直してください。",
          ok: false,
          reason: "invalid",
        };
      }
    }

    return {
      message: genericPasswordResetConfirmErrorMessage,
      ok: false,
      reason: "system",
    };
  }
};
