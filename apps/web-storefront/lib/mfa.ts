/**
 * A reader's two-step verification: the code a sign-in asks for after the
 * password or a provider's sign-in, and the authenticator the reader sets up,
 * keeps the recovery codes of, and turns off from **Security**.
 *
 * One authenticator serves the site, the app, and the tenant's console, so an
 * account of staff that set one up in the console is asked for its code here
 * too.
 */

import {
  isUnauthenticatedRpcError,
  RPC_ERROR_REASON,
  rethrowUnclassifiedRpcError,
  rpcErrorHasReason,
} from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { freshConfirmationFields } from "./auth";
import type { AccountConfirmation } from "./auth";
import { mfaCodeRefusalOf } from "./mfa-shared";
import type { MfaCodeRefusal } from "./mfa-shared";

/** Whether the signed-in reader holds an authenticator, and since when. */
export interface MyMfaStatus {
  enabled: boolean;
  /** RFC 3339, and empty while `enabled` is false. */
  enabledAt: string;
  /** What is left of the ten recovery codes. */
  remainingRecoveryCodes: number;
}

/**
 * The signed-in reader's two-step verification, or `null` without a session.
 * A session the API rejects is rethrown for the caller's reauthentication.
 */
export const getMyMfaStatus = async (
  tenantId: string,
  accessToken?: string
): Promise<MyMfaStatus | null> => {
  const sid = await resolveAccessToken(accessToken);

  if (!sid) {
    return null;
  }

  const response = await apiClient.auth.getMfaStatus(
    { tenant: { tenantId } },
    buildSessionHeaders(sid)
  );

  return {
    enabled: response.enabled,
    enabledAt: response.enabledAt,
    remainingRecoveryCodes: response.remainingRecoveryCodes,
  };
};

/**
 * A change to the reader's authenticator the API refused. `code` is a code it
 * turned away, which the form says and stays on; `error` is anything else, for
 * the form to word. A session the API rejects is neither: it is rethrown for
 * the caller's reauthentication, as is anything unclassified.
 */
export type MfaChangeOutcome<Result extends object = object> =
  | ({ ok: true } & Result)
  | { code: MfaCodeRefusal; ok: false }
  | { error: unknown; ok: false };

const mfaChangeRefusal = (
  cause: unknown
): Extract<MfaChangeOutcome, { ok: false }> => {
  rethrowUnclassifiedRpcError(cause);

  const code = mfaCodeRefusalOf(cause);

  if (code) {
    return { code, ok: false };
  }

  if (isUnauthenticatedRpcError(cause)) {
    throw cause;
  }

  return { error: cause, ok: false };
};

/** Whether the API refused enrollment to an account it sends to the console. */
export const isMfaSetUpInConsoleError = (cause: unknown): boolean =>
  rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaSetUpInConsole);

/**
 * Start setting an authenticator up, replacing one started and never
 * confirmed. The secret is readable only from this answer.
 */
export const startMyMfaEnrollment = async (
  tenantId: string,
  accessToken?: string
): Promise<MfaChangeOutcome<{ otpauthUri: string; secret: string }>> => {
  const sid = await resolveAccessToken(accessToken);

  try {
    const response = await apiClient.auth.startMfaEnrollment(
      { tenant: { tenantId } },
      buildSessionHeaders(sid)
    );

    return {
      ok: true,
      otpauthUri: response.otpauthUri,
      secret: response.secret,
    };
  } catch (error) {
    return mfaChangeRefusal(error);
  }
};

/**
 * Confirm the authenticator {@link startMyMfaEnrollment} set up with a code
 * from it, which turns two-step verification on and answers the ten recovery
 * codes, in plaintext this once.
 */
export const confirmMyMfaEnrollment = async (
  tenantId: string,
  code: string,
  accessToken?: string
): Promise<MfaChangeOutcome<{ recoveryCodes: string[] }>> => {
  const sid = await resolveAccessToken(accessToken);

  try {
    const response = await apiClient.auth.confirmMfaEnrollment(
      { code, tenant: { tenantId } },
      buildSessionHeaders(sid)
    );

    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return mfaChangeRefusal(error);
  }
};

/**
 * Replace every recovery code the reader holds, used or not, confirmed with a
 * code from the authenticator. A recovery code is refused here.
 */
export const regenerateMyMfaRecoveryCodes = async (
  tenantId: string,
  code: string,
  accessToken?: string
): Promise<MfaChangeOutcome<{ recoveryCodes: string[] }>> => {
  const sid = await resolveAccessToken(accessToken);

  try {
    const response = await apiClient.auth.regenerateMfaRecoveryCodes(
      { code, tenant: { tenantId } },
      buildSessionHeaders(sid)
    );

    return { ok: true, recoveryCodes: response.recoveryCodes };
  } catch (error) {
    return mfaChangeRefusal(error);
  }
};

/**
 * Turn two-step verification off with a code, from the authenticator or a
 * recovery code, and the account's password or, for an account without one, a
 * fresh sign-in. The API spends the fresh sign-in before it checks the code,
 * so a wrong code asks for another sign-in.
 */
export const disableMyMfa = async (
  tenantId: string,
  code: string,
  confirmation: AccountConfirmation,
  accessToken?: string
): Promise<MfaChangeOutcome> => {
  const sid = await resolveAccessToken(accessToken);

  try {
    await apiClient.auth.disableMfa(
      {
        code,
        tenant: { tenantId },
        ...("password" in confirmation
          ? { password: confirmation.password }
          : freshConfirmationFields(confirmation)),
      },
      buildSessionHeaders(sid)
    );

    return { ok: true };
  } catch (error) {
    return mfaChangeRefusal(error);
  }
};
