import { parseInstant } from "@publira/utils";
import {
  encryptSessionPayload,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";

import {
  PLATFORM_SESSION_CACHE_TAG,
  PLATFORM_SESSION_COOKIE_NAME,
} from "./auth-shared";
import { toCookieExpires } from "./cookie-expiry";

export interface PlatformSession {
  accessToken: string;
  expiresAt: Temporal.Instant;
}

/** A session the API issued, or `null` when it answered an unusable one. */
export const toPlatformSession = (
  token: string | undefined,
  expiresAtRaw: string | undefined
): PlatformSession | null => {
  const accessToken = token?.trim() ?? "";
  const expiresAt = parseInstant(expiresAtRaw ?? "");
  if (!(accessToken && expiresAt)) {
    return null;
  }
  return { accessToken, expiresAt };
};

/**
 * Seal the API session the console just earned into its own cookie.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers are
 * still open, and `updateTag()` is rejected outside an Action. Both places a
 * session can begin write it through here: the password alone, and the second
 * factor that finished the sign-in afterwards.
 */
export const writePlatformSessionCookie = async (
  session: PlatformSession
): Promise<void> => {
  const sealed = await encryptSessionPayload(
    {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt.toString(),
    },
    resolveAuthSecret()
  );
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(toCookieExpires(session.expiresAt)),
    name: PLATFORM_SESSION_COOKIE_NAME,
    value: sealed,
  });
  updateTag(PLATFORM_SESSION_CACHE_TAG);
};
