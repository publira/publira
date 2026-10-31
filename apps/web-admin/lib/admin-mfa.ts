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
import type { RpcErrorMessageOverrides } from "@publira/api-client/error-messages";
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

/** A passkey the signed-in account registered for the console. */
export interface AdminPasskey {
  id: string;
  /** Empty until its owner names it. */
  name: string;
  /** RFC 3339, as the API answered it. */
  createdAt: string;
  /** RFC 3339, or empty until it first answers a sign-in. */
  lastUsedAt: string;
}

export interface AdminMfaStatus {
  /** The TOTP authenticator is confirmed. A passkey does not set it. */
  enabled: boolean;
  /** Oldest first. */
  passkeys: AdminPasskey[];
  /** Shared by the authenticator and every passkey. */
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

/** A ceremony the signed-in account begins, which has no challenge to expire. */
export type AdminPasskeyConfirmationStartResult =
  | { ok: true; optionsJson: string }
  | { ok: false; message: string };

export type AdminPasskeyVerifyResult =
  | { ok: true; session: AdminMfaSession }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminPasskeyRegistrationResult =
  | {
      ok: true;
      /** The stored passkey, for naming it once the ceremony is over. */
      passkeyId: string;
      /** Empty when the account already held unused recovery codes. */
      recoveryCodes: string[];
      /** Set only when a challenge finished the login rather than a session. */
      session: AdminMfaSession | null;
    }
  | { ok: false; message: string; challengeExpired: boolean };

export type AdminMfaDisableResult =
  | { ok: true }
  | { ok: false; message: string };

export type AdminPasskeyChangeResult =
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
  cause: unknown,
  locale: Locale
): Promise<string | null> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaLocked)) {
    return t("admin.auth.mfa.errors.locked");
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaInvalidCode)) {
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
  cause: unknown,
  locale: Locale,
  requires: MfaRequirement
): Promise<string> => {
  const rejected = await mfaCodeRejectionMessage(cause, locale);

  if (rejected) {
    return rejected;
  }

  const t = await getMessagesFor(locale);
  rethrowUnauthenticatedRpcError(cause);
  rethrowUnclassifiedRpcError(cause);

  const copy = mfaFailureCopy(t, requires);

  return rpcErrorMessage(cause, copy.fallback, {
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
  cause: unknown,
  locale: Locale,
  requires: MfaRequirement
): Promise<{ message: string; challengeExpired: boolean }> => {
  const rejected = await mfaCodeRejectionMessage(cause, locale);

  if (rejected) {
    return { challengeExpired: false, message: rejected };
  }

  const t = await getMessagesFor(locale);

  if (isUnauthenticatedRpcError(cause)) {
    return {
      challengeExpired: true,
      message: t("admin.auth.mfa.expired"),
    };
  }

  rethrowUnclassifiedRpcError(cause);
  const copy = mfaFailureCopy(t, requires);

  return {
    challengeExpired: false,
    message: rpcErrorMessage(cause, copy.fallback, {
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
  cause: unknown,
  locale: Locale,
  ceremony: "registration" | "verification"
): Promise<{ message: string; challengeExpired: boolean }> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaLocked)) {
    return {
      challengeExpired: false,
      message: t("admin.auth.mfa.errors.locked"),
    };
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaPasskeyRefused)) {
    return {
      challengeExpired: false,
      message:
        ceremony === "verification"
          ? t("admin.auth.mfa.errors.passkey_refused")
          : t("admin.auth.mfa.errors.passkey_registration_refused"),
    };
  }

  if (isUnauthenticatedRpcError(cause)) {
    return { challengeExpired: true, message: t("admin.auth.mfa.expired") };
  }

  rethrowUnclassifiedRpcError(cause);

  return {
    challengeExpired: false,
    message:
      ceremony === "verification"
        ? rpcErrorMessage(cause, t("admin.auth.mfa.errors.passkey_failed"), {
            locale,
            overrides: {
              precondition: t("admin.auth.mfa.errors.passkey_not_registered"),
            },
          })
        : rpcErrorMessage(cause, t("admin.auth.mfa.errors.enroll_failed"), {
            locale,
            overrides: {
              conflict: t("admin.auth.mfa.errors.passkey_already_registered"),
            },
          }),
  };
};

/**
 * Wording for a failure on a passkey RPC the *session* authorized.
 *
 * The one refusal with a reason of its own is a registration the API could
 * not verify. Anything that says the session is unusable is rethrown for
 * `withAdminSessionReauth()`, as it is for a code, and every other category
 * takes the operation's own wording from `overrides` or `fallback`.
 */
const sessionPasskeyFailureMessage = async (
  cause: unknown,
  locale: Locale,
  fallback: string,
  overrides: RpcErrorMessageOverrides
): Promise<string> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaPasskeyRefused)) {
    return t("admin.auth.mfa.errors.passkey_registration_refused");
  }

  rethrowUnauthenticatedRpcError(cause);
  rethrowUnclassifiedRpcError(cause);

  return rpcErrorMessage(cause, fallback, { locale, overrides });
};

/**
 * Wording for a refused passkey confirmation the *session* authorized.
 *
 * A refused assertion is `unauthenticated`, as a rejected session is, so its
 * reason is read before anything rethrows the error for
 * `withAdminSessionReauth()`: without it a passkey the console did not accept
 * would sign the operator out. An account left with no passkey to confirm
 * with is the failed precondition.
 */
const sessionPasskeyConfirmationFailureMessage = async (
  cause: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaLocked)) {
    return t("admin.auth.mfa.errors.locked");
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaPasskeyRefused)) {
    return t("admin.auth.mfa.errors.passkey_refused");
  }

  rethrowUnauthenticatedRpcError(cause);
  rethrowUnclassifiedRpcError(cause);

  return rpcErrorMessage(cause, t("admin.auth.mfa.errors.passkey_failed"), {
    locale,
    overrides: {
      precondition: t("admin.settings.mfa.regenerate_passkey_missing"),
    },
  });
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
    const [response, { passkeys }] = await Promise.all([
      apiClient.auth.getMfaStatus(
        { tenant: { tenantId } },
        withSessionHeaders(token)
      ),
      apiClient.auth.listPasskeys(
        { tenant: { tenantId } },
        withSessionHeaders(token)
      ),
    ]);

    return {
      ok: true,
      status: {
        enabled: response.enabled,
        passkeys: passkeys.map((passkey) => ({
          createdAt: passkey.createdAt,
          id: passkey.id,
          lastUsedAt: passkey.lastUsedAt,
          name: passkey.name,
        })),
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
 * The signed-in operator's second factors — the authenticator app's status
 * and the passkeys, read together because one card shows both — or a
 * rejected session. Any other failure reaches the error boundary: the account
 * screen has no copy for a status it could not read.
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

/**
 * Replace the signed-in account's recovery codes, proved with a code from the
 * authenticator or with an assertion one of its passkeys made over a ceremony
 * {@link beginAdminPasskeyConfirmation} began.
 */
export const regenerateAdminMfaRecoveryCodes = async (
  tenantId: string,
  proof: { code: string } | { passkeyCredentialJson: string },
  locale: Locale
): Promise<AdminMfaRecoveryCodesResult> => {
  const sessionToken = await getAccessToken();

  try {
    const response = await apiClient.auth.regenerateMfaRecoveryCodes(
      { ...proof, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );

    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return {
      message:
        "code" in proof
          ? await sessionMfaFailureMessage(error, locale, "enabled")
          : await sessionPasskeyConfirmationFailureMessage(error, locale),
      ok: false,
    };
  }
};

/**
 * Start confirming a recovery-code regeneration with one of the signed-in
 * account's passkeys.
 */
export const beginAdminPasskeyConfirmation = async (
  tenantId: string,
  locale: Locale
): Promise<AdminPasskeyConfirmationStartResult> => {
  const sessionToken = await getAccessToken();

  try {
    const response = await apiClient.auth.beginPasskeyConfirmation(
      { tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );

    return { ok: true, optionsJson: response.requestOptionsJson };
  } catch (error) {
    return {
      message: await sessionPasskeyConfirmationFailureMessage(error, locale),
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
 * Wording for a refused registration the session authorized: the account
 * already holding the credential is the one refusal with copy of its own.
 */
const sessionPasskeyRegistrationFailure = async (
  cause: unknown,
  locale: Locale
): Promise<{ message: string; challengeExpired: boolean }> => {
  const t = await getMessagesFor(locale);

  return {
    challengeExpired: false,
    message: await sessionPasskeyFailureMessage(
      cause,
      locale,
      t("admin.settings.mfa.passkey_add_failed"),
      { conflict: t("admin.auth.mfa.errors.passkey_already_registered") }
    ),
  };
};

/**
 * Start registering a passkey, for an account the tenant is holding at the
 * login screen until it enrolls a second factor and for a signed-in one
 * adding a passkey from its account settings.
 *
 * `challengeToken` is what separates the two, as it is for
 * {@link startAdminMfaEnrollment}: empty means the signed-in account.
 */
export const beginAdminPasskeyRegistration = async (
  tenantId: string,
  challengeToken: string,
  locale: Locale
): Promise<AdminPasskeyCeremonyStartResult> => {
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.beginPasskeyRegistration(
          { challengeToken, tenant: { tenantId } },
          await withClientAddressHeaders()
        )
      : await apiClient.auth.beginPasskeyRegistration(
          { challengeToken: "", tenant: { tenantId } },
          withSessionHeaders(sessionToken)
        );

    return { ok: true, optionsJson: response.creationOptionsJson };
  } catch (error) {
    return {
      ...(challengeToken
        ? await challengePasskeyFailure(error, locale, "registration")
        : await sessionPasskeyRegistrationFailure(error, locale)),
      ok: false,
    };
  }
};

/**
 * Store the passkey the browser created. Under an enroll challenge it finishes
 * the login the challenge was holding, as confirming an authenticator does.
 */
export const finishAdminPasskeyRegistration = async (
  tenantId: string,
  challengeToken: string,
  credentialJson: string,
  locale: Locale
): Promise<AdminPasskeyRegistrationResult> => {
  const sessionToken = challengeToken ? "" : await getAccessToken();

  try {
    const response = challengeToken
      ? await apiClient.auth.finishPasskeyRegistration(
          { challengeToken, credentialJson, name: "", tenant: { tenantId } },
          await withClientAddressHeaders()
        )
      : await apiClient.auth.finishPasskeyRegistration(
          {
            challengeToken: "",
            credentialJson,
            name: "",
            tenant: { tenantId },
          },
          withSessionHeaders(sessionToken)
        );

    return {
      ok: true,
      passkeyId: response.passkey?.id ?? "",
      recoveryCodes: response.recoveryCodes,
      session: toMfaSession(
        response.accessToken?.token,
        response.accessToken?.expiresAt
      ),
    };
  } catch (error) {
    return {
      ...(challengeToken
        ? await challengePasskeyFailure(error, locale, "registration")
        : await sessionPasskeyRegistrationFailure(error, locale)),
      ok: false,
    };
  }
};

/** Name one of the signed-in account's passkeys; an empty name clears it. */
export const renameAdminPasskey = async (
  tenantId: string,
  id: string,
  name: string,
  locale: Locale
): Promise<AdminPasskeyChangeResult> => {
  const [t, sessionToken] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  try {
    await apiClient.auth.renamePasskey(
      { id, name, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );

    return { ok: true };
  } catch (error) {
    return {
      message: await sessionPasskeyFailureMessage(
        error,
        locale,
        t("admin.settings.mfa.passkey_rename_failed"),
        {
          "invalid-argument": t("admin.settings.mfa.passkey_name_too_long"),
          "not-found": t("admin.settings.mfa.passkey_not_found"),
        }
      ),
      ok: false,
    };
  }
};

/**
 * Remove one of the signed-in account's passkeys. The API refuses the last
 * second factor of an account the tenant requires one of, which is the
 * failed precondition worded here.
 */
export const deleteAdminPasskey = async (
  tenantId: string,
  id: string,
  locale: Locale
): Promise<AdminPasskeyChangeResult> => {
  const [t, sessionToken] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  try {
    await apiClient.auth.deletePasskey(
      { id, tenant: { tenantId } },
      withSessionHeaders(sessionToken)
    );

    return { ok: true };
  } catch (error) {
    return {
      message: await sessionPasskeyFailureMessage(
        error,
        locale,
        t("admin.settings.mfa.passkey_remove_failed"),
        {
          "not-found": t("admin.settings.mfa.passkey_not_found"),
          precondition: t("admin.settings.mfa.passkey_last_factor"),
        }
      ),
      ok: false,
    };
  }
};
