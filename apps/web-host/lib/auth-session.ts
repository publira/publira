import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveAccessToken } from "./api-client";
import {
  buildLoginPath,
  getPublicSessionCacheTag,
  isUnauthenticatedError,
  PUBLIC_SESSION_COOKIE_NAME,
} from "./auth-shared";

/**
 * Drop the local session cookie.
 *
 * **Server Actions only.** `cookies().delete()` needs a response whose headers
 * are still open, and `updateTag()` is rejected outside an Action, so this
 * cannot run while a page or layout renders. The re-authentication helpers
 * below therefore never call it — a rejected session is cleared by the proxy on
 * the `/login` request that follows the redirect.
 */
export const clearPublicSessionCookie = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(PUBLIC_SESSION_COOKIE_NAME);
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));
};

/**
 * Send the reader to `/login` with a sanitized `returnTo`, flagged as a
 * rejected session so the proxy clears the cookie instead of bouncing them
 * back. Safe to call while rendering.
 */
export const redirectToLogin = (returnTo: string | null | undefined): never => {
  redirect(buildLoginPath(returnTo, { revoked: true }));
};

/**
 * Resolve the session for work that must not run without one.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * route that rendered the form it was submitted from.
 */
export const requirePublicSession = async (
  returnTo: string
): Promise<string> => {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    redirectToLogin(returnTo);
  }
  return accessToken;
};

/**
 * Run an authenticated call, turning the API's rejection of the session into
 * the re-authentication flow.
 *
 * Only `Code.Unauthenticated` qualifies. Everything else — a wrong password, a
 * validation failure, an outage — propagates unchanged, so a business error is
 * never mistaken for a lost session (Epic #65 / #679).
 */
export const withPublicSessionReauth = async <T>(
  returnTo: string,
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      redirectToLogin(returnTo);
    }
    throw error;
  }
};
