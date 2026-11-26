/**
 * The console's side of a re-authentication: the operations a session alone
 * does not reach — handing out a role or an API key, pointing the tenant's
 * money, mail, or events elsewhere, a refund, a reader's account — are refused
 * with `REAUTHENTICATION_REQUIRED` until the operator proves again who they
 * are. The proof earns a step-up token, kept in its own cookie and sent beside
 * the session by `stepUpCallOptions`, and the form that was refused is
 * sent again.
 */

import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  RPC_ERROR_REASON,
  rpcErrorHasFieldViolation,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { parseInstant } from "@publira/utils";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { confirmationRejectionMessage } from "./admin-mfa";
import type { AdminMfaConfirmation } from "./admin-mfa";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import { writeStepUpCookie } from "./step-up";

/**
 * What the operator can prove themselves with besides the password, which
 * every console account has.
 */
export interface ReauthenticationFactors {
  authenticator: boolean;
  passkey: boolean;
}

/**
 * The state an Action answers when the API refused it for want of a recent
 * re-authentication. `Reauthentication.Request` in the form reads it and asks
 * the operator, and the form is sent again once they have answered.
 */
export interface ReauthenticationRequiredState {
  ok: false;
  message: string;
  reauthentication: ReauthenticationFactors & { tenantId: string };
}

/**
 * Whether what {@link withReauthentication} answered is the request for a
 * re-authentication, which an Action returns as it is so the form can ask.
 */
export const isReauthenticationRequired = <T>(
  result: T | ReauthenticationRequiredState
): result is ReauthenticationRequiredState =>
  typeof result === "object" && result !== null && "reauthentication" in result;

/**
 * Let a refusal for want of a re-authentication through to
 * {@link withReauthentication}, which is the one place that answers it. A
 * `lib/` function whose RPC asks for a step-up calls this first in its `catch`,
 * beside `rethrowUnauthenticatedRpcError`.
 */
export const rethrowReauthenticationRequiredRpcError = (
  cause: unknown
): void => {
  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.reauthenticationRequired)) {
    throw cause;
  }
};

/**
 * The factors the account holds, for the dialog to offer beside the password.
 * A read that fails leaves the password alone on offer, which every account
 * can answer with, so the operator is not stopped by it.
 */
const readReauthenticationFactors = async (
  tenantId: string,
  sessionToken: string
): Promise<ReauthenticationFactors> => {
  try {
    const [status, { passkeys }] = await Promise.all([
      apiClient.auth.getMfaStatus(
        { tenant: { tenantId } },
        withSessionHeaders(sessionToken)
      ),
      apiClient.auth.listPasskeys(
        { tenant: { tenantId } },
        withSessionHeaders(sessionToken)
      ),
    ]);

    return { authenticator: status.enabled, passkey: passkeys.length > 0 };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return { authenticator: false, passkey: false };
  }
};

/**
 * Run a Server Action's work, and answer a refusal for want of a
 * re-authentication with the state that asks the operator for one. Every other
 * outcome is `run`'s own. Wrap it inside `withAdminSessionReauth`, so a session
 * that is gone still signs the operator out first.
 */
export const withReauthentication = async <T>(
  tenantId: string,
  locale: Locale,
  run: () => Promise<T>
): Promise<T | ReauthenticationRequiredState> => {
  try {
    return await run();
  } catch (error) {
    if (!rpcErrorHasReason(error, RPC_ERROR_REASON.reauthenticationRequired)) {
      throw error;
    }

    const [t, sessionToken] = await Promise.all([
      getMessagesFor(locale),
      getAccessToken(),
    ]);

    return {
      message: t("admin.reauthentication.required"),
      ok: false,
      reauthentication: {
        ...(await readReauthenticationFactors(tenantId, sessionToken)),
        tenantId,
      },
    };
  }
};

export type ReauthenticateAdminInput =
  | { password: string }
  | { confirmation: AdminMfaConfirmation };

export type ReauthenticateAdminResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: { password?: string } };

/**
 * Prove the operator again, with their password or one of their second
 * factors, and keep the step-up token it earns for the operations that ask
 * for one.
 *
 * **Server Actions only**, since it writes the cookie.
 */
export const reauthenticateAdmin = async (
  tenantId: string,
  input: ReauthenticateAdminInput,
  locale: Locale
): Promise<ReauthenticateAdminResult> => {
  const [t, sessionToken] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  if (!sessionToken) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.auth.reauthenticate(
      {
        confirmation:
          "confirmation" in input
            ? {
                code: input.confirmation.code,
                passkeyCredentialJson: input.confirmation.passkeyCredentialJson,
              }
            : undefined,
        password: "password" in input ? input.password : "",
        tenant: { tenantId },
      },
      withSessionHeaders(sessionToken)
    );

    const token = response.stepUpToken?.token.trim() ?? "";
    const expiresAt = parseInstant(response.stepUpToken?.expiresAt ?? "");

    if (!(token && expiresAt)) {
      return { message: t("admin.reauthentication.errors.failed"), ok: false };
    }

    await writeStepUpCookie({ expiresAt, token });

    return { ok: true };
  } catch (error) {
    // A refused code or passkey is `unauthenticated`, as a session that is
    // gone is, so the reason is read before anything signs the operator out.
    const rejected = await confirmationRejectionMessage(error, locale);

    if (rejected) {
      return { message: rejected, ok: false };
    }

    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    if (rpcErrorHasFieldViolation(error, "password")) {
      const invalid = t("admin.reauthentication.errors.invalid_password");

      return {
        fieldErrors: { password: invalid },
        message: invalid,
        ok: false,
      };
    }

    return {
      message: rpcErrorMessage(
        error,
        t("admin.reauthentication.errors.failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
