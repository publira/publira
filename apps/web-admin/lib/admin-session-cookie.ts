import {
  encryptSessionPayload,
  resolveAuthSecret,
  sessionCookieOptions,
} from "@publira/web-session";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";
import { toCookieExpires } from "./cookie-expiry";

export interface AdminSession {
  accessToken: string;
  expiresAt: Temporal.Instant;
}

/**
 * Seal the API session the console just earned into its own cookie.
 *
 * **Server Actions only** — writing a cookie needs a response whose headers are
 * still open. Both places a session can begin write it through here: the
 * password alone, and the second factor that finished the login afterwards.
 */
export const writeAdminSessionCookie = async (
  tenantId: string,
  session: AdminSession
): Promise<void> => {
  const sealed = await encryptSessionPayload(
    {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt.toString(),
      tenantId,
    },
    resolveAuthSecret()
  );
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(toCookieExpires(session.expiresAt)),
    name: ADMIN_SESSION_COOKIE_NAME,
    value: sealed,
  });
};
