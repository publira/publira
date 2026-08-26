import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { apiClient } from "./api-client";
import { loadPlatformMessages } from "./locale";

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
  email: string,
  locale: Locale
): Promise<PlatformPasswordResetRequestResult> => {
  const normalizedEmail = email.trim();
  if (!normalizedEmail) {
    const messages = await loadPlatformMessages(locale);
    return {
      message: getMessage(messages, "platform.auth.fields.email_required"),
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
    const messages = await loadPlatformMessages(locale);

    return {
      message: rpcErrorMessage(
        error,
        getMessage(messages, "platform.auth.errors.reset_request_failed"),
        {
          locale,
          overrides: {
            // Email is the only field this call takes.
            "invalid-argument": getMessage(
              messages,
              "platform.auth.errors.reset_request_invalid_email"
            ),
          },
        }
      ),
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
  newPassword: string,
  locale: Locale
): Promise<PlatformPasswordResetConfirmResult> => {
  const normalizedToken = token.trim();
  const normalizedPassword = newPassword.trim();
  const messages = await loadPlatformMessages(locale);

  if (!normalizedToken) {
    return {
      message: getMessage(messages, "platform.auth.errors.reset_link_invalid"),
      ok: false,
      reason: "invalid",
    };
  }

  if (!normalizedPassword) {
    return {
      message: getMessage(
        messages,
        "platform.auth.errors.new_password_required"
      ),
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
        message: getMessage(
          messages,
          "platform.auth.errors.reset_link_expired"
        ),
        ok: false,
        reason: "expired",
      };
    }
    // An unknown token and a malformed one both mean "start over".
    if (disposition === "not-found" || disposition === "invalid-argument") {
      return {
        message: getMessage(
          messages,
          "platform.auth.errors.reset_link_invalid"
        ),
        ok: false,
        reason: "invalid",
      };
    }

    return {
      message: getMessage(
        messages,
        "platform.auth.errors.reset_confirm_failed"
      ),
      ok: false,
      reason: "system",
    };
  }
};
