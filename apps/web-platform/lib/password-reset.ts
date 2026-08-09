import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";

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
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
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
