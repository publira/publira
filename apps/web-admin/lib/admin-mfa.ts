/**
 * The console's side of the administrator second factor.
 *
 * Every call here presents a code or a passkey, and the API answers a refused
 * one with `unauthenticated` — the same code a rejected session gets. The two
 * are told apart by the `MFA_INVALID_CODE` / `MFA_PASSKEY_REFUSED` /
 * `MFA_LOCKED` reason the server attaches: without it a mistyped digit would
 * sign the operator out, which is exactly what the re-authentication flow
 * exists to avoid.
 */

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  isUnauthenticatedRpcError,
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withClientAddressHeaders, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import type { AdminMessageAccessor } from "./messages";
import { getAccessToken } from "./session";

export interface AdminMfaSession {
  accessToken: string;
  expiresAt: Temporal.Instant;
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

export type AdminPasskeyCeremonyStartResult =
  | {
      ok: true;
      /**
       * The options the browser's ceremony takes, as the API serialized them
       * for `PublicKeyCredential.parse*OptionsFromJSON`.
       */
      optionsJson: string;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminPasskeyVerifyResult =
  | { ok: true; session: AdminMfaSession }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminPasskeyRegistrationResult =
  | {
      ok: true;
      /** Empty when the account already held unused recovery codes. */
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
  const expiresAt = parseInstant(expiresAtRaw ?? "");
  if (!(accessToken && expiresAt)) {
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
const mfaCodeRejectionMessage = async (
  error: unknown,
  locale: Locale
): Promise<string | null> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaLocked)) {
    return t("admin.auth.mfa.errors.locked");
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaInvalidCode)) {
    return t("admin.auth.mfa.errors.invalid_code");
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
  t: AdminMessageAccessor,
  requires: MfaRequirement
): { fallback: string; precondition: string } =>
  requires === "disabled"
    ? {
        fallback: t("admin.auth.mfa.errors.enroll_failed"),
        precondition: t("admin.auth.mfa.errors.already_enabled"),
      }
    : {
        fallback: t("admin.auth.mfa.errors.verify_failed"),
        precondition: t("admin.auth.mfa.errors.not_enabled"),
      };

/**
 * Wording for a failure on an RPC the *session* authorized.
 *
 * A refused code stays a form message; anything else that says the session is
 * unusable is rethrown, so `withAdminSessionReauth()` turns it into the login
 * redirect rather than a dead end next to the code field.
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
 * not about the code means the half-finished login has run out; the screen
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
      message: t("admin.auth.mfa.expired"),
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
 * Wording for a failure on a passkey RPC a *challenge token* authorized.
 *
 * A refused assertion counts toward the same lock a wrong code does, so the
 * lock is read first. Each ceremony has refusals of its own: answering with a
 * passkey the account no longer holds, and registering one it already does.
 * An `unauthenticated` with no reason is the challenge running out, as it is
 * for a code.
 */
const challengePasskeyFailure = async (
  error: unknown,
  locale: Locale,
  ceremony: "registration" | "verification"
): Promise<{ message: string; challengeExpired: boolean }> => {
  const t = await getMessagesFor(locale);
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaLocked)) {
    return {
      challengeExpired: false,
      message: t("admin.auth.mfa.errors.locked"),
    };
  }
  if (rpcErrorHasReason(error, RPC_ERROR_REASON.mfaPasskeyRefused)) {
    return {
      challengeExpired: false,
      message:
        ceremony === "verification"
          ? t("admin.auth.mfa.errors.passkey_refused")
          : t("admin.auth.mfa.errors.passkey_registration_refused"),
    };
  }
  if (isUnauthenticatedRpcError(error)) {
    return { challengeExpired: true, message: t("admin.auth.mfa.expired") };
  }

  rethrowUnclassifiedRpcError(error);

  return {
    challengeExpired: false,
    message:
      ceremony === "verification"
        ? rpcErrorMessage(error, t("admin.auth.mfa.errors.passkey_failed"), {
            locale,
            overrides: {
              precondition: t("admin.auth.mfa.errors.passkey_not_registered"),
            },
          })
        : rpcErrorMessage(error, t("admin.auth.mfa.errors.enroll_failed"), {
            locale,
            overrides: {
              conflict: t("admin.auth.mfa.errors.passkey_already_registered"),
            },
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

const getAdminMfaStatusForSession = async (
  tenantId: string,
  token: string
): Promise<CachedRead<GetAdminMfaStatusResult>> => {
  "use cache: private";

  cacheTag(adminMfaStatusCacheTag(tenantId));

  if (!token) {
    dropFailedCacheEntry();
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
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    // Any other failure is the error screen, thrown by the caller. Only the
    // verdict crosses the cache boundary, so the cause is logged here, where
    // the error is still whole.
    console.warn("[web-admin] getAdminMfaStatus failed", error);
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: false, unexpected: true };
  }
};

/**
 * The signed-in operator's second factor, or a rejected session. Any other
 * failure reaches the error boundary: the account screen has no copy for a
 * status it could not read.
 */
export const getAdminMfaStatus = async (
  tenantId: string
): Promise<GetAdminMfaStatusResult> => {
  const { unexpected, ...result } = await getAdminMfaStatusForSession(
    tenantId,
    await getAccessToken()
  );
  if (unexpected) {
    throw new Error("The second factor's status could not be read.");
  }
  return result;
};

export const verifyAdminMfa = async (
  tenantId: string,
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<AdminMfaVerifyResult> => {
  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.auth.verifyMfa(
      { challengeToken, code, tenant: { tenantId } },
      await withClientAddressHeaders()
    );

    const session = toMfaSession(
      response.accessToken?.token,
      response.accessToken?.expiresAt
    );
    if (!session) {
      return {
        challengeExpired: false,
        message: t("admin.auth.mfa.errors.verify_failed"),
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
  const t = await getMessagesFor(locale);
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.startMfaEnrollment(
          { challengeToken, tenant: { tenantId } },
          await withClientAddressHeaders()
        )
      : await apiClient.auth.startMfaEnrollment(
          { challengeToken: "", tenant: { tenantId } },
          withSessionHeaders(sessionToken)
        );

    const secret = response.secret.trim();
    const otpauthUri = response.otpauthUri.trim();
    if (!(secret && otpauthUri)) {
      return {
        challengeExpired: false,
        message: t("admin.auth.mfa.errors.enroll_failed"),
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

export const confirmAdminMfaEnrollment = async (
  tenantId: string,
  challengeToken: string,
  code: string,
  locale: Locale
): Promise<AdminMfaEnrollmentConfirmResult> => {
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.confirmMfaEnrollment(
          { challengeToken, code, tenant: { tenantId } },
          await withClientAddressHeaders()
        )
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

export const disableAdminMfa = async (
  tenantId: string,
  code: string,
  locale: Locale
): Promise<AdminMfaDisableResult> => {
  const sessionToken = await getAccessToken();

  try {
    await apiClient.auth.disableMfa(
      { code, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );
    return { ok: true };
  } catch (error) {
    return {
      message: await sessionMfaFailureMessage(error, locale, "enabled"),
      ok: false,
    };
  }
};

export const regenerateAdminMfaRecoveryCodes = async (
  tenantId: string,
  code: string,
  locale: Locale
): Promise<AdminMfaRecoveryCodesResult> => {
  const sessionToken = await getAccessToken();

  try {
    const response = await apiClient.auth.regenerateMfaRecoveryCodes(
      { code, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );
    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return {
      message: await sessionMfaFailureMessage(error, locale, "enabled"),
      ok: false,
    };
  }
};

/** Start answering a verify challenge with one of the account's passkeys. */
export const beginAdminPasskeyVerification = async (
  tenantId: string,
  challengeToken: string,
  locale: Locale
): Promise<AdminPasskeyCeremonyStartResult> => {
  try {
    const response = await apiClient.auth.beginPasskeyVerification(
      { challengeToken, tenant: { tenantId } },
      await withClientAddressHeaders()
    );
    return { ok: true, optionsJson: response.requestOptionsJson };
  } catch (error) {
    return {
      ...(await challengePasskeyFailure(error, locale, "verification")),
      ok: false,
    };
  }
};

/** Exchange a verify challenge and the assertion the browser made for a session. */
export const finishAdminPasskeyVerification = async (
  tenantId: string,
  challengeToken: string,
  credentialJson: string,
  locale: Locale
): Promise<AdminPasskeyVerifyResult> => {
  const t = await getMessagesFor(locale);

  try {
    const response = await apiClient.auth.finishPasskeyVerification(
      { challengeToken, credentialJson, tenant: { tenantId } },
      await withClientAddressHeaders()
    );

    const session = toMfaSession(
      response.accessToken?.token,
      response.accessToken?.expiresAt
    );
    if (!session) {
      return {
        challengeExpired: false,
        message: t("admin.auth.mfa.errors.passkey_failed"),
        ok: false,
      };
    }

    return { ok: true, session };
  } catch (error) {
    return {
      ...(await challengePasskeyFailure(error, locale, "verification")),
      ok: false,
    };
  }
};

/**
 * Start registering a passkey for an account the tenant is holding at the
 * login screen until it enrolls a second factor.
 */
export const beginAdminPasskeyRegistration = async (
  tenantId: string,
  challengeToken: string,
  locale: Locale
): Promise<AdminPasskeyCeremonyStartResult> => {
  try {
    const response = await apiClient.auth.beginPasskeyRegistration(
      { challengeToken, tenant: { tenantId } },
      await withClientAddressHeaders()
    );
    return { ok: true, optionsJson: response.creationOptionsJson };
  } catch (error) {
    return {
      ...(await challengePasskeyFailure(error, locale, "registration")),
      ok: false,
    };
  }
};

/**
 * Store the passkey the browser created, which finishes the login the enroll
 * challenge was holding, as confirming an authenticator does.
 */
export const finishAdminPasskeyRegistration = async (
  tenantId: string,
  challengeToken: string,
  credentialJson: string,
  locale: Locale
): Promise<AdminPasskeyRegistrationResult> => {
  try {
    const response = await apiClient.auth.finishPasskeyRegistration(
      { challengeToken, credentialJson, name: "", tenant: { tenantId } },
      await withClientAddressHeaders()
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
    return {
      ...(await challengePasskeyFailure(error, locale, "registration")),
      ok: false,
    };
  }
};
