/**
 * The console's side of the administrator second factor (Epic #59).
 *
 * Every call here presents a code, and the API answers a refused code with
 * `unauthenticated` — the same code a rejected session gets. The two are told
 * apart by the `MFA_INVALID_CODE` / `MFA_LOCKED` reason the server attaches:
 * without it a mistyped digit would sign the operator out, which is exactly
 * what the re-authentication flow exists to avoid (#679).
 */

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { loadAdminMessages } from "./locale";
import type { AdminMessageKey, AdminMessages } from "./locale";
import { getAccessToken } from "./session";

export interface AdminMfaSession {
  accessToken: string;
  expiresAt: Date;
}

export interface AdminMfaStatus {
  enabled: boolean;
  remainingRecoveryCodes: number;
  required: boolean;
}

export type GetAdminMfaStatusResult =
  | { ok: true; status: AdminMfaStatus }
  | { ok: false; requiresSignIn: boolean };

export type AdminMfaVerifyResult =
  | {
      ok: true;
      session: AdminMfaSession;
      recoveryCodeUsed: boolean;
      remainingRecoveryCodes: number;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminMfaEnrollmentStartResult =
  | { ok: true; otpauthUri: string; secret: string }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminMfaEnrollmentConfirmResult =
  | {
      ok: true;
      recoveryCodes: string[];
      /** Set only when a challenge finished the login rather than a session. */
      session: AdminMfaSession | null;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminMfaDisableResult =
  | { ok: true }
  | { ok: false; message: string };

export type AdminMfaRecoveryCodesResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; message: string };

/** A session the API issued, or `null` when it answered an unusable one. */
const toMfaSession = (
  token: string | undefined,
  expiresAtRaw: string | undefined
): AdminMfaSession | null => {
  const accessToken = token?.trim() ?? "";
  const expiresAt = new Date(expiresAtRaw ?? "");
  if (!accessToken || Number.isNaN(expiresAt.getTime())) {
    return null;
  }
  return { accessToken, expiresAt };
};

/**
 * The wording for a refused code, or `null` when the failure was not about the
 * code at all.
 *
 * Read before anything classifies the error by `Code` alone: the reason is the
 * only thing separating "that code is wrong" from "your session is gone".
 */
const mfaCodeRejectionMessage = (
  error: unknown,
  messages: AdminMessages
): string | null => {
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaLocked)) {
    return getMessage(messages, "admin.auth.mfa.errors.locked");
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaInvalidCode)) {
    return getMessage(messages, "admin.auth.mfa.errors.invalid_code");
  }
  return null;
};

/**
 * Which copy stands in for a failure with no wording of its own: the
 * operation's own generic message, and what a failed precondition means for
 * this particular call.
 */
interface MfaFailureKeys {
  fallback: AdminMessageKey;
  precondition: AdminMessageKey;
}

const NOT_ENABLED_KEYS: MfaFailureKeys = {
  fallback: "admin.auth.mfa.errors.verify_failed",
  precondition: "admin.auth.mfa.errors.not_enabled",
};

const ENROLL_KEYS: MfaFailureKeys = {
  fallback: "admin.auth.mfa.errors.enroll_failed",
  precondition: "admin.auth.mfa.errors.already_enabled",
};

/**
 * Wording for a failure on an RPC the *session* authorized.
 *
 * A refused code stays a form message; anything else that says the session is
 * unusable is rethrown, so `withAdminSessionReauth()` turns it into the login
 * redirect rather than a dead end next to the code field.
 */
const sessionMfaFailureMessage = (
  error: unknown,
  messages: AdminMessages,
  locale: Locale,
  keys: MfaFailureKeys
): string => {
  const rejected = mfaCodeRejectionMessage(error, messages);
  if (rejected) {
    return rejected;
  }

  rethrowUnauthenticatedRpcError(error);
  rethrowUnclassifiedRpcError(error);

  return rpcErrorMessage(error, getMessage(messages, keys.fallback), {
    locale,
    overrides: { precondition: getMessage(messages, keys.precondition) },
  });
};

/**
 * Wording for a failure on an RPC a *challenge token* authorized.
 *
 * There is no session to re-authenticate here, so an `unauthenticated` that is
 * not about the code means the half-finished login has run out; the screen
 * reports that and sends the operator back to `/login`.
 */
const challengeMfaFailure = (
  error: unknown,
  messages: AdminMessages,
  locale: Locale,
  keys: MfaFailureKeys
): { message: string; challengeExpired: boolean } => {
  const rejected = mfaCodeRejectionMessage(error, messages);
  if (rejected) {
    return { challengeExpired: false, message: rejected };
  }

  if (isUnauthenticatedRpcError(error)) {
    return {
      challengeExpired: true,
      message: getMessage(messages, "admin.auth.mfa.expired"),
    };
  }

  rethrowUnclassifiedRpcError(error);

  return {
    challengeExpired: false,
    message: rpcErrorMessage(error, getMessage(messages, keys.fallback), {
      locale,
      overrides: { precondition: getMessage(messages, keys.precondition) },
    }),
  };
};

/**
 * Tag the account screen's cached status read carries, so `updateTag` in a
 * Server Action shows the factor being turned on or off in the same session
 * instead of leaving the previous state in the private cache.
 */
export const adminMfaStatusCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:admin-mfa-status`;

export const getAdminMfaStatus = async (
  tenantId: string
): Promise<GetAdminMfaStatusResult> => {
  "use cache: private";

  cacheTag(adminMfaStatusCacheTag(tenantId));

  const token = await getAccessToken();
  if (!token) {
    return { ok: false, requiresSignIn: true };
  }

  try {
    const response = await apiClient.auth.getMfaStatus(
      { tenant: { tenantId } },
      withSessionHeaders(token)
    );

    return {
      ok: true,
      status: {
        enabled: response.enabled,
        remainingRecoveryCodes: response.remainingRecoveryCodes,
        required: response.required,
      },
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      return { ok: false, requiresSignIn: true };
    }
    throw error;
  }
};

export const verifyAdminMfa = async (
  tenantId: string,
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<AdminMfaVerifyResult> => {
  const messages = await loadAdminMessages(locale);

  try {
    const response = await apiClient.auth.verifyMfa({
      challengeToken,
      code,
      tenant: { tenantId },
    });

    const session = toMfaSession(
      response.accessToken?.token,
      response.accessToken?.expiresAt
    );
    if (!session) {
      return {
        challengeExpired: false,
        message: getMessage(messages, "admin.auth.mfa.errors.verify_failed"),
        ok: false,
      };
    }

    return {
      ok: true,
      recoveryCodeUsed: response.recoveryCodeUsed,
      remainingRecoveryCodes: response.remainingRecoveryCodes,
      session,
    };
  } catch (error) {
    return {
      ...challengeMfaFailure(error, messages, locale, NOT_ENABLED_KEYS),
      ok: false,
    };
  }
};

/**
 * Begin an enrollment, for an operator who chose to and for one the tenant is
 * holding at the login screen until they do.
 *
 * `challengeToken` is what separates the two: empty means a signed-in account,
 * identified by its session.
 */
export const startAdminMfaEnrollment = async (
  tenantId: string,
  challengeToken: string,
  locale: Locale
): Promise<AdminMfaEnrollmentStartResult> => {
  const messages = await loadAdminMessages(locale);
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.startMfaEnrollment({
          challengeToken,
          tenant: { tenantId },
        })
      : await apiClient.auth.startMfaEnrollment(
          { challengeToken: "", tenant: { tenantId } },
          withSessionHeaders(sessionToken)
        );

    const secret = response.secret.trim();
    const otpauthUri = response.otpauthUri.trim();
    if (!(secret && otpauthUri)) {
      return {
        challengeExpired: false,
        message: getMessage(messages, "admin.auth.mfa.errors.enroll_failed"),
        ok: false,
      };
    }

    return { ok: true, otpauthUri, secret };
  } catch (error) {
    if (challengeToken) {
      return {
        ...challengeMfaFailure(error, messages, locale, ENROLL_KEYS),
        ok: false,
      };
    }

    return {
      challengeExpired: false,
      message: sessionMfaFailureMessage(error, messages, locale, ENROLL_KEYS),
      ok: false,
    };
  }
};

export const confirmAdminMfaEnrollment = async (
  tenantId: string,
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<AdminMfaEnrollmentConfirmResult> => {
  const messages = await loadAdminMessages(locale);
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.confirmMfaEnrollment({
          challengeToken,
          code,
          tenant: { tenantId },
        })
      : await apiClient.auth.confirmMfaEnrollment(
          { challengeToken: "", code, tenant: { tenantId } },
          withSessionHeaders(sessionToken)
        );

    return {
      ok: true,
      recoveryCodes: response.recoveryCodes,
      session: toMfaSession(
        response.accessToken?.token,
        response.accessToken?.expiresAt
      ),
    };
  } catch (error) {
    if (challengeToken) {
      return {
        ...challengeMfaFailure(error, messages, locale, ENROLL_KEYS),
        ok: false,
      };
    }

    return {
      challengeExpired: false,
      message: sessionMfaFailureMessage(error, messages, locale, ENROLL_KEYS),
      ok: false,
    };
  }
};

export const disableAdminMfa = async (
  tenantId: string,
  code: string,
  locale: Locale
): Promise<AdminMfaDisableResult> => {
  const messages = await loadAdminMessages(locale);
  const sessionToken = await getAccessToken();

  try {
    await apiClient.auth.disableMfa(
      { code, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );
    return { ok: true };
  } catch (error) {
    return {
      message: sessionMfaFailureMessage(
        error,
        messages,
        locale,
        NOT_ENABLED_KEYS
      ),
      ok: false,
    };
  }
};

export const regenerateAdminMfaRecoveryCodes = async (
  tenantId: string,
  code: string,
  locale: Locale
): Promise<AdminMfaRecoveryCodesResult> => {
  const messages = await loadAdminMessages(locale);
  const sessionToken = await getAccessToken();

  try {
    const response = await apiClient.auth.regenerateMfaRecoveryCodes(
      { code, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );
    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return {
      message: sessionMfaFailureMessage(
        error,
        messages,
        locale,
        NOT_ENABLED_KEYS
      ),
      ok: false,
    };
  }
};
