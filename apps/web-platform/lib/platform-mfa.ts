/**
 * The console's side of the operator second factor.
 *
 * Every call here presents a code, and the API answers a refused code with
 * `unauthenticated` — the same code a rejected session gets. The two are told
 * apart by the `MFA_INVALID_CODE` / `MFA_LOCKED` reason the server attaches:
 * without it a mistyped digit would sign the operator out, which is exactly
 * what the re-authentication flow exists to avoid.
 */

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildClientAddressHeaders,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import { getMessagesFor } from "./messages";
import type { PlatformMessageAccessor } from "./messages";
import { toPlatformSession } from "./platform-session-cookie";
import type { PlatformSession } from "./platform-session-cookie";

export interface PlatformMfaStatus {
  enabled: boolean;
  remainingRecoveryCodes: number;
  required: boolean;
}

export type GetPlatformMfaStatusResult =
  | { ok: true; status: PlatformMfaStatus }
  | { ok: false; requiresSignIn: boolean };

export type PlatformMfaVerifyResult =
  | {
      ok: true;
      session: PlatformSession;
      recoveryCodeUsed: boolean;
      remainingRecoveryCodes: number;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type PlatformMfaEnrollmentStartResult =
  | { ok: true; otpauthUri: string; secret: string }
  | { ok: false; message: string; challengeExpired: boolean };

export type PlatformMfaEnrollmentConfirmResult =
  | {
      ok: true;
      recoveryCodes: string[];
      /** Set only when a challenge finished the sign-in rather than a session. */
      session: PlatformSession | null;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type PlatformMfaDisableResult =
  | { ok: true }
  | { ok: false; message: string };

export type PlatformMfaRecoveryCodesResult =
  | { ok: true; recoveryCodes: string[] }
  | { ok: false; message: string };

/**
 * The wording for a refused code, or `null` when the failure was not about the
 * code at all.
 *
 * Read before anything classifies the error by `Code` alone: the reason is the
 * only thing separating "that code is wrong" from "your session is gone".
 */
const mfaCodeRejectionMessage = async (
  error: unknown,
  locale: Locale
): Promise<string | null> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaLocked)) {
    return t("platform.auth.mfa.errors.locked");
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaInvalidCode)) {
    return t("platform.auth.mfa.errors.invalid_code");
  }
  return null;
};

/**
 * The state of the factor an MFA call requires: enrollment needs it off,
 * everything else needs it on.
 */
type MfaRequirement = "disabled" | "enabled";

/**
 * Which copy stands in for a failure with no wording of its own: the
 * operation's own generic message, and what a failed precondition means for
 * this particular call.
 */
const mfaFailureCopy = (
  t: PlatformMessageAccessor,
  requires: MfaRequirement
): { fallback: string; precondition: string } =>
  requires === "disabled"
    ? {
        fallback: t("platform.auth.mfa.errors.enroll_failed"),
        precondition: t("platform.auth.mfa.errors.already_enabled"),
      }
    : {
        fallback: t("platform.auth.mfa.errors.verify_failed"),
        precondition: t("platform.auth.mfa.errors.not_enabled"),
      };

/**
 * Wording for a failure on an RPC the *session* authorized.
 *
 * A refused code stays a form message; anything else that says the session is
 * unusable is rethrown, so `withPlatformSessionReauth()` turns it into the
 * sign-in redirect rather than a dead end next to the code field.
 */
const sessionMfaFailureMessage = async (
  error: unknown,
  locale: Locale,
  requires: MfaRequirement
): Promise<string> => {
  const rejected = await mfaCodeRejectionMessage(error, locale);
  if (rejected) {
    return rejected;
  }

  const t = await getMessagesFor(locale);
  rethrowUnauthenticatedRpcError(error);
  rethrowUnclassifiedRpcError(error);

  const copy = mfaFailureCopy(t, requires);

  return rpcErrorMessage(error, copy.fallback, {
    locale,
    overrides: { precondition: copy.precondition },
  });
};

/**
 * Wording for a failure on an RPC a *challenge token* authorized.
 *
 * There is no session to re-authenticate here, so an `unauthenticated` that is
 * not about the code means the half-finished sign-in has run out; the screen
 * reports that and sends the operator back to `/login`.
 */
const challengeMfaFailure = async (
  error: unknown,
  locale: Locale,
  requires: MfaRequirement
): Promise<{ message: string; challengeExpired: boolean }> => {
  const rejected = await mfaCodeRejectionMessage(error, locale);
  if (rejected) {
    return { challengeExpired: false, message: rejected };
  }

  const t = await getMessagesFor(locale);
  if (isUnauthenticatedRpcError(error)) {
    return {
      challengeExpired: true,
      message: t("platform.auth.mfa.expired"),
    };
  }

  rethrowUnclassifiedRpcError(error);
  const copy = mfaFailureCopy(t, requires);

  return {
    challengeExpired: false,
    message: rpcErrorMessage(error, copy.fallback, {
      locale,
      overrides: { precondition: copy.precondition },
    }),
  };
};

/**
 * Tag the account screen's cached status read carries, so `updateTag` in a
 * Server Action shows the factor being turned on or off in the same session
 * instead of leaving the previous state in the private cache.
 */
export const PLATFORM_MFA_STATUS_CACHE_TAG = "platform-mfa-status";

const getPlatformMfaStatusForSession = async (
  token: string
): Promise<GetPlatformMfaStatusResult> => {
  "use cache: private";

  cacheTag(PLATFORM_MFA_STATUS_CACHE_TAG);

  if (!token) {
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: true };
  }

  try {
    const response = await apiClient.auth.getMfaStatus(
      {},
      buildSessionHeaders(token)
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
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    throw error;
  }
};

export const getPlatformMfaStatus =
  async (): Promise<GetPlatformMfaStatusResult> =>
    getPlatformMfaStatusForSession(await resolveAccessToken());

export const verifyPlatformMfa = async (
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<PlatformMfaVerifyResult> => {
  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.auth.verifyMfa(
      { challengeToken, code },
      await buildClientAddressHeaders()
    );

    const session = toPlatformSession(
      response.accessToken?.token,
      response.accessToken?.expiresAt
    );
    if (!session) {
      return {
        challengeExpired: false,
        message: t("platform.auth.mfa.errors.verify_failed"),
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
      ...(await challengeMfaFailure(error, locale, "enabled")),
      ok: false,
    };
  }
};

/**
 * Begin an enrollment, for an operator who chose to and for one the platform
 * policy is holding at the sign-in screen until they do.
 *
 * `challengeToken` is what separates the two: empty means a signed-in
 * operator, identified by its session.
 */
export const startPlatformMfaEnrollment = async (
  challengeToken: string,
  locale: Locale
): Promise<PlatformMfaEnrollmentStartResult> => {
  const t = await getMessagesFor(locale);
  const sessionToken = challengeToken ? "" : await resolveAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.startMfaEnrollment(
          { challengeToken },
          await buildClientAddressHeaders()
        )
      : await apiClient.auth.startMfaEnrollment(
          { challengeToken: "" },
          buildSessionHeaders(sessionToken)
        );

    const secret = response.secret.trim();
    const otpauthUri = response.otpauthUri.trim();
    if (!(secret && otpauthUri)) {
      return {
        challengeExpired: false,
        message: t("platform.auth.mfa.errors.enroll_failed"),
        ok: false,
      };
    }

    return { ok: true, otpauthUri, secret };
  } catch (error) {
    if (challengeToken) {
      return {
        ...(await challengeMfaFailure(error, locale, "disabled")),
        ok: false,
      };
    }

    return {
      challengeExpired: false,
      message: await sessionMfaFailureMessage(error, locale, "disabled"),
      ok: false,
    };
  }
};

export const confirmPlatformMfaEnrollment = async (
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<PlatformMfaEnrollmentConfirmResult> => {
  const sessionToken = challengeToken ? "" : await resolveAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.confirmMfaEnrollment(
          { challengeToken, code },
          await buildClientAddressHeaders()
        )
      : await apiClient.auth.confirmMfaEnrollment(
          { challengeToken: "", code },
          buildSessionHeaders(sessionToken)
        );

    return {
      ok: true,
      recoveryCodes: response.recoveryCodes,
      session: toPlatformSession(
        response.accessToken?.token,
        response.accessToken?.expiresAt
      ),
    };
  } catch (error) {
    if (challengeToken) {
      return {
        ...(await challengeMfaFailure(error, locale, "disabled")),
        ok: false,
      };
    }

    return {
      challengeExpired: false,
      message: await sessionMfaFailureMessage(error, locale, "disabled"),
      ok: false,
    };
  }
};

export const disablePlatformMfa = async (
  code: string,
  locale: Locale
): Promise<PlatformMfaDisableResult> => {
  const sessionToken = await resolveAccessToken();

  try {
    await apiClient.auth.disableMfa(
      { code },
      buildSessionHeaders(sessionToken)
    );
    return { ok: true };
  } catch (error) {
    return {
      message: await sessionMfaFailureMessage(error, locale, "enabled"),
      ok: false,
    };
  }
};

export const regeneratePlatformMfaRecoveryCodes = async (
  code: string,
  locale: Locale
): Promise<PlatformMfaRecoveryCodesResult> => {
  const sessionToken = await resolveAccessToken();

  try {
    const response = await apiClient.auth.regenerateMfaRecoveryCodes(
      { code },
      buildSessionHeaders(sessionToken)
    );
    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return {
      message: await sessionMfaFailureMessage(error, locale, "enabled"),
      ok: false,
    };
  }
};
