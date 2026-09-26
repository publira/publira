import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import { apiClient, buildClientAddressHeaders } from "./api-client";
import { getMessagesFor } from "./messages";

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
    const t = await getMessagesFor(locale);
    return {
      message: t("platform.auth.fields.email_required"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.requestPasswordReset(
      { email: normalizedEmail },
      await buildClientAddressHeaders()
    );

    return {
      ok: true,
      requested: response.requested,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);

    return {
      message: rpcErrorMessage(
        error,
        t("platform.auth.errors.reset_request_failed"),
        {
          locale,
          overrides: {
            // Email is the only field this call takes.
            "invalid-argument": t(
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
  const t = await getMessagesFor(locale);

  if (!normalizedToken) {
    return {
      message: t("platform.auth.errors.reset_link_invalid"),
      ok: false,
      reason: "invalid",
    };
  }

  if (!newPassword.trim()) {
    return {
      message: t("platform.auth.errors.new_password_required"),
      ok: false,
      reason: "system",
    };
  }

  try {
    const response = await apiClient.auth.confirmPasswordReset(
      {
        newPassword,
        token: normalizedToken,
      },
      await buildClientAddressHeaders()
    );

    return {
      confirmed: response.confirmed,
      ok: true,
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    const disposition = rpcErrorDisposition(error);
    if (disposition === "precondition") {
      return {
        message: t("platform.auth.errors.reset_link_expired"),
        ok: false,
        reason: "expired",
      };
    }
    // An unknown token and a malformed one both mean "start over".
    if (disposition === "not-found" || disposition === "invalid-argument") {
      return {
        message: t("platform.auth.errors.reset_link_invalid"),
        ok: false,
        reason: "invalid",
      };
    }

    return {
      message: t("platform.auth.errors.reset_confirm_failed"),
      ok: false,
      reason: "system",
    };
  }
};
