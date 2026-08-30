import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";

import { splitLocalePathname, withLocalePrefix } from "./locale-path";

export const PUBLIC_SESSION_COOKIE_NAME = profileCookieName(
  "publira_web_host_auth"
);

const PUBLIC_SESSION_CACHE_TAG_PREFIX = "public-session-cookie";

export const getPublicSessionCacheTag = (cookieName: string): string =>
  `${PUBLIC_SESSION_CACHE_TAG_PREFIX}-${cookieName}`;

/**
 * Normalize a return destination to a **locale-less** in-app path.
 *
 * `returnTo` travels through URLs and form fields that a reader can edit, and
 * the locale it should come back in is decided by whoever performs the
 * redirect — the login page is served under a locale, so pinning one into the
 * stored path would let `/en/login?returnTo=/ja/my` throw the reader back into
 * the other language. Dropping the locale segment here also means the
 * `/login` check below still sees `/login` when the submitted value was
 * `/ja/login`, so the re-authentication loop stays closed.
 */
export const sanitizeRedirectPath = (
  path: string | null | undefined
): string => {
  if (!path || !path.startsWith("/")) {
    return "/";
  }

  // Browsers can treat `/\evil.example` as the protocol-relative `//evil.example`.
  if (path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }

  const suffixStart = path.search(/[?#]/u);
  const pathname = suffixStart === -1 ? path : path.slice(0, suffixStart);
  const suffix = suffixStart === -1 ? "" : path.slice(suffixStart);
  const bare = splitLocalePathname(pathname).pathname;
  if (bare.startsWith("/login")) {
    return "/";
  }

  return `${bare}${suffix}`;
};

/**
 * Marks a `/login` visit that a rejected session sent the reader to, rather
 * than one they navigated to themselves.
 *
 * The proxy cannot tell the two apart on its own. A session revoked elsewhere
 * — a `credentials_version` bump from another device — still decrypts locally
 * and has not reached its local expiry, so `hasActivePublicSessionCookie`
 * reports it as active and the guest-only rule bounces the reader straight
 * back to `/my`, which redirects to `/login` again. The marker breaks that
 * loop: the proxy drops the cookie and lets the login page render.
 *
 * It doubles as the flash key the re-authentication flow displays (Epic #65).
 */
export const SESSION_REVOKED_PARAM_NAME = "reason";
export const SESSION_REVOKED_REASON = "session_revoked";

export const buildLoginPath = (
  locale: Locale,
  defaultLocale: Locale,
  returnTo: string | null | undefined,
  options?: { revoked?: boolean }
): string => {
  const params = new URLSearchParams({
    returnTo: sanitizeRedirectPath(returnTo),
  });
  if (options?.revoked) {
    params.set(SESSION_REVOKED_PARAM_NAME, SESSION_REVOKED_REASON);
  }
  return `${withLocalePrefix(locale, defaultLocale, "/login")}?${params.toString()}`;
};

/** Whether this request is the redirect a rejected session produced. */
export const isSessionRevokedRedirect = (requestUrl: URL): boolean =>
  requestUrl.searchParams.get(SESSION_REVOKED_PARAM_NAME) ===
  SESSION_REVOKED_REASON;

/** A rejected Bearer token always follows the re-authentication flow. */
export const isUnauthenticatedError = (error: unknown): boolean =>
  isUnauthenticatedRpcError(error);

/**
 * A session cookie is valid only when it can be decrypted and its local expiry
 * has not elapsed. The proxy uses this before allowing a protected route or
 * bouncing a stale cookie away from `/login`.
 */
export const hasActivePublicSessionCookie = async (
  value?: string | null
): Promise<boolean> => {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }

  const payload = await decryptSessionPayload(raw, resolveAuthSecret());
  return payload !== null && !isSessionExpired(payload.expiresAt);
};

/**
 * The `/{locale}/login` URL a proxy redirect goes to, carrying the path the
 * reader was denied as a locale-less `returnTo`.
 */
export const buildLoginUrl = (
  requestUrl: URL,
  locale: Locale,
  defaultLocale: Locale,
  options?: { returnToParamName?: string }
): URL => {
  const { returnToParamName = "returnTo" } = options ?? {};

  const loginUrl = new URL(
    withLocalePrefix(locale, defaultLocale, "/login"),
    requestUrl
  );
  const returnToPath = sanitizeRedirectPath(
    `${requestUrl.pathname}${requestUrl.search}`
  );
  loginUrl.searchParams.set(returnToParamName, returnToPath);
  return loginUrl;
};
