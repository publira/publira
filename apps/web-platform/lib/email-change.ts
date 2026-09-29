import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";

import {
  apiClient,
  buildClientAddressHeaders,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getMessagesFor } from "./messages";

export type EmailChangeRequestResult =
  | { message: string; ok: false }
  | { ok: true; requested: boolean };

export const requestPlatformEmailChange = async (
  currentEmail: string,
  newEmail: string,
  currentPassword: string,
  locale: Locale
): Promise<EmailChangeRequestResult> => {
  const normalizedCurrentEmail = currentEmail.trim();
  const normalizedNewEmail = newEmail.trim();
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!normalizedCurrentEmail || !normalizedNewEmail || !currentPassword) {
    return {
      message: t("platform.auth.setup.name_required"),
      ok: false,
    };
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("platform.settings.email_change_failed"),
        {
          locale,
          overrides: {
            conflict: t("platform.settings.email_in_use"),
            "invalid-argument": rpcErrorHasFieldViolation(
              error,
              "current_password"
            )
              ? t("platform.settings.wrong_password")
              : t("errors.validation"),
          },
        }
      ),
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
    const response = await apiClient.auth.confirmEmailChange(
      { token },
      await buildClientAddressHeaders()
    );
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
