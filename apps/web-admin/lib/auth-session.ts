import { updateTag } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  ADMIN_SESSION_CACHE_TAG,
  ADMIN_SESSION_COOKIE_NAME,
  buildLoginPath,
  isUnauthenticatedError,
  RETURN_TO_HEADER_NAME,
  sanitizeRedirectPath,
} from "./admin-auth-shared";
import { getAccessToken } from "./session";

/**
 * Reported by a read that runs inside a `"use cache"` scope, where the redirect
 * below cannot be raised: `requiresSignIn` says the API rejected the session, so
 * the caller raises it outside the scope instead of rendering a failure the
 * operator can do nothing about.
 */
export interface SessionRejectable {
  ok: boolean;
  requiresSignIn?: boolean;
}

/**
 * Drop the local session cookie.
 *
 * **Server Actions only.** `cookies().delete()` needs a response whose headers
 * are still open, and `updateTag()` is rejected outside an Action, so this
 * cannot run while a page or layout renders. The re-authentication helpers below
 * therefore never call it — a rejected session is cleared by the proxy on the
 * `/login` request that follows the redirect.
 */
export const clearAdminSessionCookie = async (): Promise<void> => {
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_SESSION_COOKIE_NAME);
  updateTag(ADMIN_SESSION_CACHE_TAG);
};

/**
 * Where login should send the operator back to: the path `proxy.ts` recorded
 * for this request, sanitized again here so a header written by anything else
 * cannot turn the redirect into an open one.
 */
const resolveReturnTo = async (): Promise<string> => {
  const requestHeaders = await headers();
  return sanitizeRedirectPath(requestHeaders.get(RETURN_TO_HEADER_NAME));
};

/**
 * Send the operator to `/login`, flagged as a rejected session so the proxy
 * clears the cookie. Safe to call while rendering — the cookie is not touched
 * here — but not from inside a `"use cache"` scope, which may read neither
 * headers nor raise the redirect.
 */
export const redirectToLogin = async (): Promise<never> => {
  redirect(buildLoginPath(await resolveReturnTo(), { revoked: true }));
};

/**
 * Raise the re-authentication redirect for reads that reported the rejection as
 * a value, because they ran inside a `"use cache"` scope.
 *
 * Variadic because a screen usually awaits several session-scoped reads at once
 * and any one of them rejecting means the same thing.
 */
export const redirectToLoginIfSessionRejected = async (
  ...results: SessionRejectable[]
): Promise<void> => {
  if (results.some((result) => result.requiresSignIn)) {
    await redirectToLogin();
  }
};

/**
 * Resolve the session for work that must not run without one.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * route that rendered the form it was submitted from.
 */
export const requireAdminSession = async (): Promise<string> => {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    await redirectToLogin();
  }
  return accessToken;
};

/**
 * Run an authenticated call, turning the API's rejection of the session into the
 * re-authentication flow.
 *
 * Only `Code.Unauthenticated` qualifies. Everything else — a wrong password, a
 * validation failure, an outage — propagates unchanged, so a business error is
 * never mistaken for a lost session (Epic #65 / #679).
 */
export const withAdminSessionReauth = async <T>(
  run: () => Promise<T>
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      await redirectToLogin();
    }
    throw error;
  }
};
