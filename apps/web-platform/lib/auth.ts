import {
  isExpectedNullableRpcError,
  isRejectedRequestRpcError,
  isUnauthenticatedRpcError,
  rpcErrorDisposition,
} from "@publira/api-client/errors";
import { MfaChallengeKind } from "@publira/api-client/platform/auth";
import { parseInstant } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheLife, cacheTag } from "next/cache";

import {
  apiClient,
  buildClientAddressHeaders,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import { PLATFORM_SESSION_CACHE_TAG } from "./auth-shared";
import type { MfaChallengeKindName } from "./mfa-challenge";
import { toPlatformSession } from "./platform-session-cookie";
import type { PlatformSession } from "./platform-session-cookie";
import { normalizePlatformRole } from "./roles";

export {
  PLATFORM_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "./auth-shared";

export interface PlatformCurrentOperator {
  name: string;
  publicId: string;
  role: string;
}

/**
 * The signed-in operator, or why they could not be read.
 *
 * `requiresSignIn` separates a session the API rejected from a `GetMe` that
 * answered nothing useful. Both used to arrive as `null`, and only the first is
 * a reason to send the operator through login again.
 */
export type GetPlatformCurrentOperatorResult =
  | { ok: true; operator: PlatformCurrentOperator }
  | { ok: false; requiresSignIn: boolean };

/**
 * What a password sign-in came to. A refused one says whether the credentials
 * were wrong or too many attempts had been made for the password to be checked
 * at all: the second is no reason to tell the operator their password is wrong.
 *
 * A right password that still owes a second factor earns a challenge rather
 * than a session, and `processing` is a response the console cannot hold: the
 * password was right, so it is no reason to say the credentials were not.
 */
export type PlatformLoginResult =
  | { ok: true; kind: "session"; session: PlatformSession }
  | {
      ok: true;
      kind: "challenge";
      challengeKind: MfaChallengeKindName;
      challengeToken: string;
      expiresAt: Temporal.Instant;
    }
  | { ok: false; refusal: "credentials" | "processing" | "rate-limited" };

/**
 * The challenge kind as the console names it, or `null` for a kind this build
 * has no screen for — which is a sign-in it cannot finish, not one to wave
 * through on the password alone.
 */
const toChallengeKindName = (
  kind: MfaChallengeKind
): MfaChallengeKindName | null => {
  if (kind === MfaChallengeKind.VERIFY) {
    return "verify";
  }
  if (kind === MfaChallengeKind.ENROLL) {
    return "enroll";
  }
  return null;
};

export const loginPlatform = async (
  email: string,
  password: string
): Promise<PlatformLoginResult> => {
  try {
    const response = await apiClient.auth.login(
      {
        email,
        password,
      },
      await buildClientAddressHeaders()
    );
    const challenge = response.mfaChallenge;
    if (challenge) {
      const challengeKind = toChallengeKindName(challenge.kind);
      const challengeToken = challenge.token.trim();
      const expiresAt = parseInstant(challenge.expiresAt);
      if (!(challengeKind && challengeToken && expiresAt)) {
        return { ok: false, refusal: "processing" };
      }
      return {
        challengeKind,
        challengeToken,
        expiresAt,
        kind: "challenge",
        ok: true,
      };
    }

    const session = toPlatformSession(
      response.accessToken?.token,
      response.accessToken?.expiresAt
    );
    if (!session) {
      return { ok: false, refusal: "credentials" };
    }
    return { kind: "session", ok: true, session };
  } catch (error) {
    if (isRejectedRequestRpcError(error)) {
      return {
        ok: false,
        refusal:
          rpcErrorDisposition(error) === "rate-limited"
            ? "rate-limited"
            : "credentials",
      };
    }
    throw error;
  }
};

export const logoutPlatform = async (accessToken: string): Promise<void> => {
  if (!accessToken.trim()) {
    return;
  }
  try {
    await apiClient.auth.logout({}, buildSessionHeaders(accessToken));
  } catch {
    // The cookie is cleared either way: an expired session and an unreachable
    // API both leave the caller with nothing worth keeping.
  }
};

/**
 * `GetMe` for one session.
 *
 * Every console route awaits it — the chrome names the operator, and
 * `verifyPlatformSession` gates each shared read on it — so its `stale` is how
 * long a browser keeps a route before asking again whether the session still
 * stands. Five minutes is the shortest that still lets the routes keep their
 * prefetched App Shell.
 */
const getPlatformCurrentOperatorForSession = async (
  sid: string
): Promise<GetPlatformCurrentOperatorResult> => {
  "use cache: private";
  cacheLife("minutes");
  cacheTag(PLATFORM_SESSION_CACHE_TAG);

  if (!sid) {
    dropFailedCacheEntry();
    return { ok: false, requiresSignIn: true };
  }
  try {
    const response = await apiClient.auth.getMe({}, buildSessionHeaders(sid));
    const { user } = response;
    if (!user) {
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: false };
    }
    return {
      ok: true,
      operator: {
        name: user.name,
        publicId: user.publicId,
        role: normalizePlatformRole(user.role),
      },
    };
  } catch (error) {
    if (isUnauthenticatedRpcError(error)) {
      // A rejected session must not be cached, or the console would keep
      // redirecting to /login after the operator has signed in again.
      dropFailedCacheEntry();
      return { ok: false, requiresSignIn: true };
    }
    if (isExpectedNullableRpcError(error)) {
      return { ok: false, requiresSignIn: false };
    }
    throw error;
  }
};

export const getPlatformCurrentOperator =
  async (): Promise<GetPlatformCurrentOperatorResult> =>
    getPlatformCurrentOperatorForSession(await resolveAccessToken());
