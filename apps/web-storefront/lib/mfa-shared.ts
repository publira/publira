import {
  RPC_ERROR_REASON,
  rpcErrorDisposition,
  rpcErrorHasReason,
} from "@publira/api-client/errors";
import { parseInstant } from "@publira/utils";

/**
 * The half-finished sign-in a password, or a provider's sign-in, earns an
 * account that holds an authenticator. Only `VerifyMfa` takes the token, and
 * it buys one session.
 */
export interface PublicMfaChallenge {
  /** RFC 3339. */
  expiresAt: string;
  token: string;
}

/**
 * The challenge a sign-in answered, or `null` for one that issued a session.
 * A challenge whose expiry is not an instant is no challenge: nothing could
 * say when to stop offering the code step for it.
 */
export const toPublicMfaChallenge = (
  challenge: { expiresAt: string; token: string } | undefined
): PublicMfaChallenge | null => {
  const token = challenge?.token.trim() ?? "";

  if (!(token && challenge && parseInstant(challenge.expiresAt))) {
    return null;
  }

  return { expiresAt: challenge.expiresAt, token };
};

/**
 * Why the API turned a code away, for the form to say and to stay on.
 *
 * - `invalid_code`: a wrong code, which counts toward the lock.
 * - `locked`: too many wrong codes; every code is refused for a while.
 * - `rate_limited`: too many attempts at the account's password or codes.
 */
export type MfaCodeRefusal = "invalid_code" | "locked" | "rate_limited";

/**
 * The refusal of a code, read from the reason before anything looks at the
 * code alone: a wrong code is `unauthenticated` too, and only the reason tells
 * it from a session, or a challenge, the API no longer takes.
 */
export const mfaCodeRefusalOf = (cause: unknown): MfaCodeRefusal | null => {
  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaLocked)) {
    return "locked";
  }

  if (rpcErrorHasReason(cause, RPC_ERROR_REASON.mfaInvalidCode)) {
    return "invalid_code";
  }

  if (rpcErrorDisposition(cause) === "rate-limited") {
    return "rate_limited";
  }

  return null;
};
