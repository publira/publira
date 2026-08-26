import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { loadPlatformMessages } from "./locale";

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
  const [messages, sessionId] = await Promise.all([
    loadPlatformMessages(locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: getMessage(messages, "errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  if (!normalizedCurrentEmail || !normalizedNewEmail || !currentPassword) {
    return {
      message: getMessage(messages, "platform.auth.setup.name_required"),
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
        getMessage(messages, "platform.settings.email_change_failed"),
        {
          locale,
          overrides: {
            conflict: getMessage(messages, "platform.settings.email_in_use"),
            "invalid-argument": rpcErrorHasFieldViolation(
              error,
              "current_password"
            )
              ? getMessage(messages, "platform.settings.wrong_password")
              : getMessage(messages, "errors.validation"),
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
