import type { Locale } from "@publira/i18n";
import { sessionCookieOptions } from "@publira/web-session";
import { updateTag } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { resolveAccessToken, sealSessionCookieValue } from "./api-client";
import type { PublicSession } from "./auth";
import {
  buildLoginPath,
  getPublicSessionCacheTag,
  isUnauthenticatedError,
  PUBLIC_SESSION_COOKIE_NAME,
} from "./auth-shared";
import { getTenantDefaultLocale } from "./tenant";

/**
 * Seal a freshly minted access token into the local session cookie.
 *
 * **Server Actions only**, for the same reason as the deletion below: the
 * cookie write needs a response whose headers are still open, and `updateTag()`
 * is rejected outside an Action.
 *
 * Every Action that receives a token writes it through here — signing in, and
 * changing a password, which ends the token the request arrived with and hands
 * back its replacement. A caller that seals its own cookie is one that can
 * forget the cache tag, and a stale tag serves the previous token for as long
 * as the private cache holds it.
 */
export const writePublicSessionCookie = async (
  session: PublicSession,
  tenantId: string
): Promise<void> => {
  const sealed = await sealSessionCookieValue({
    accessToken: session.accessToken,
    expiresAt: session.expiresAt.toISOString(),
    tenantId,
  });
  const cookieStore = await cookies();
  cookieStore.set({
    ...sessionCookieOptions(session.expiresAt),
    name: PUBLIC_SESSION_COOKIE_NAME,
    value: sealed,
  });
  updateTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));
};

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
 * Send the reader to `/{locale}/login` with a sanitized `returnTo`, flagged as
 * a rejected session so the proxy clears the cookie instead of bouncing them
 * back. Safe to call while rendering.
 *
 * `locale` is explicit rather than read from `next/root-params`, because half
 * the callers are Server Actions, where root params are unavailable. A Server
 * Component passes `await getLocale()` and `await getTenantId()`; an Action
 * takes them from the form fields bound by the component that rendered it.
 */
export const redirectToLogin = async (
  locale: Locale,
  returnTo: string | null | undefined,
  tenantId: string
): Promise<never> => {
  const defaultLocale = await getTenantDefaultLocale(tenantId);
  const loginPath = buildLoginPath(locale, defaultLocale, returnTo, {
    revoked: true,
  });
  return redirect(loginPath);
};

/**
 * Resolve the session for work that must not run without one.
 *
 * A Server Action is its own request, so it authenticates independently of the
 * route that rendered the form it was submitted from.
 */
export const requirePublicSession = async (
  locale: Locale,
  returnTo: string,
  tenantId: string
): Promise<string> => {
  const accessToken = await resolveAccessToken();
  if (!accessToken) {
    return redirectToLogin(locale, returnTo, tenantId);
  }
  return accessToken;
};

/**
 * Run an authenticated call, turning the API's rejection of the session into
 * the re-authentication flow.
 *
 * Only `Code.Unauthenticated` qualifies. Everything else — a wrong password, a
 * validation failure, an outage — propagates unchanged, so a business error is
 * never mistaken for a lost session.
 */
export const withPublicSessionReauth = async <T>(
  locale: Locale,
  returnTo: string,
  run: () => Promise<T>,
  tenantId: string
): Promise<T> => {
  try {
    return await run();
  } catch (error) {
    if (isUnauthenticatedError(error)) {
      return redirectToLogin(locale, returnTo, tenantId);
    }
    throw error;
  }
};
