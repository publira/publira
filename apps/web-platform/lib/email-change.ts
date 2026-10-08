import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

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

/**
 * The tag `confirmPlatformEmailChange` carries. No Action changes what it
 * reports, so nothing clears it.
 */
export const platformEmailChangeConfirmationCacheTag =
  "platform:email-change-confirmation";

/**
 * What the cached confirmation hands `confirmPlatformEmailChange`: the answer,
 * and whether its failure is one no screen copy describes. A `"use cache"`
 * scope must not throw — the fill would fail the whole request — so the scope
 * classifies the failure and the caller, outside it, throws the unexpected one.
 */
interface CachedEmailChangeConfirmation {
  result: EmailChangeConfirmResult | null;
  unexpected: boolean;
}

/**
 * The RPC spends the token, so it runs once, for the request that opened the
 * link. In a `"use cache: private"` scope the prerender Cache Components spawns
 * from that request finds the answer already filled in instead of calling the
 * API again, and with `stale` under 30 seconds it leaves the answer out rather
 * than keeping it for a prefetch.
 */
const confirmPlatformEmailChangeOnce = async (
  token: string
): Promise<CachedEmailChangeConfirmation> => {
  "use cache: private";
  cacheLife({ stale: 0 });
  cacheTag(platformEmailChangeConfirmationCacheTag);

  try {
    const response = await apiClient.auth.confirmEmailChange(
      { token },
      await buildClientAddressHeaders()
    );
    return {
      result: {
        changed: response.changed,
        confirmed: response.confirmed,
        pendingConfirmationFor: response.pendingConfirmationFor,
      },
      unexpected: false,
    };
  } catch (error) {
    dropFailedCacheEntry();
    return {
      result: null,
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * Confirms the change the link's token stands for, or `null` when the API
 * refused it. A failure no screen copy describes reaches the error boundary.
 */
export const confirmPlatformEmailChange = async (
  token: string
): Promise<EmailChangeConfirmResult | null> => {
  const { result, unexpected } = await confirmPlatformEmailChangeOnce(token);
  if (unexpected) {
    throw new Error("The email change confirmation failed unexpectedly.");
  }
  return result;
};
