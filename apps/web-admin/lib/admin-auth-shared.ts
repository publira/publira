import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { profileCookieName } from "@publira/web-session/cookie-name";

export const ADMIN_SESSION_COOKIE_NAME = profileCookieName(
  "publira_web_admin_auth"
);

/** Tag the cached cookie read carries, so clearing the cookie invalidates it. */
export const ADMIN_SESSION_CACHE_TAG = "admin-session-cookie";

/** The query parameter the console has always used to carry the return path. */
export const RETURN_TO_PARAM_NAME = "next";

/**
 * Request header `proxy.ts` writes the sanitized return path into.
 *
 * A layout, a page section, and a Server Action all need the same answer to
 * "where should login send them back to?", and none of them can read the URL
 * they are serving: `next/root-params` carries the tenant, not the path. The
 * proxy is the one place that sees it on every request, protected route and
 * Server Action POST alike, so it writes the path once and everything
 * downstream reads it instead of hard-coding a route it happens to sit on.
 *
 * That also keeps the query string, which a hard-coded constant loses — the
 * cursor token and the filters an operator was looking at survive the round
 * trip through login.
 */
export const RETURN_TO_HEADER_NAME = "x-publira-return-to";

export const sanitizeRedirectPath = (
  path: string | null | undefined
): string => {
  if (!path || !path.startsWith("/")) {
    return "/";
  }

  // Browsers can treat `/\evil.example` as the protocol-relative `//evil.example`.
  if (
    path.startsWith("//") ||
    path.startsWith("/\\") ||
    path.startsWith("/login")
  ) {
    return "/";
  }

  return path;
};

/**
 * Marks a `/login` visit that a rejected session sent the operator to, rather
 * than one they navigated to themselves.
 *
 * A page or layout cannot drop the cookie while it renders — `cookies().delete()`
 * needs a Server Function or Route Handler — so the render path marks its
 * redirect and the proxy clears the cookie on the `/login` request that follows.
 * Without that, a session revoked elsewhere (a `credentials_version` bump on
 * another device) still decrypts locally and stays inside its local expiry, so
 * the proxy keeps waving the operator through to a console that redirects them
 * straight back here.
 *
 * It doubles as the flash key the re-authentication flow displays (Epic #65).
 */
export const SESSION_REVOKED_PARAM_NAME = "reason";
export const SESSION_REVOKED_REASON = "session_revoked";

/** `/login` path with a sanitized return path, for use while rendering. */
export const buildLoginPath = (
  returnTo: string | null | undefined,
  options?: { revoked?: boolean }
): string => {
  const params = new URLSearchParams({
    [RETURN_TO_PARAM_NAME]: sanitizeRedirectPath(returnTo),
  });
  if (options?.revoked) {
    params.set(SESSION_REVOKED_PARAM_NAME, SESSION_REVOKED_REASON);
  }
  return `/login?${params.toString()}`;
};

/** Whether this request is the redirect a rejected session produced. */
export const isSessionRevokedRedirect = (requestUrl: URL): boolean =>
  requestUrl.searchParams.get(SESSION_REVOKED_PARAM_NAME) ===
  SESSION_REVOKED_REASON;

/** A rejected Bearer token always follows the re-authentication flow. */
export const isUnauthenticatedError = (error: unknown): boolean =>
  isUnauthenticatedRpcError(error);

/**
 * Let a rejected session leave a `lib/` mutation as a throw.
 *
 * Call it first in a `catch` that turns errors into an Action state message:
 * "セッションが無効です。再ログインしてください。" next to a form control is a
 * dead end, because the operator has no way to act on it from there. The Server
 * Action's `withAdminSessionReauth()` turns the throw into the login redirect
 * instead. Every other code stays a message — a wrong password or a rejected
 * field must never log the operator out (Epic #65 / #679).
 */
export const rethrowUnauthenticatedRpcError = (error: unknown): void => {
  if (isUnauthenticatedRpcError(error)) {
    throw error;
  }
};

/**
 * A session cookie is usable only when it decrypts and its local expiry has not
 * elapsed — the same two checks `getAccessToken()` makes before it hands the
 * token to an RPC, so the proxy never admits a request the console will reject.
 *
 * The raw-JWT fallback in `lib/session.ts` is deliberately not honoured here: it
 * is transitional, and no cookie the login Action writes today has that shape.
 */
export const hasActiveAdminSessionCookie = async (
  value?: string | null
): Promise<boolean> => {
  const raw = value?.trim();
  if (!raw) {
    return false;
  }

  const payload = await decryptSessionPayload(raw, resolveAuthSecret());
  return payload !== null && !isSessionExpired(payload.expiresAt);
};

/** The path a request should come back to once the operator has signed in. */
export const buildReturnToPath = (requestUrl: URL): string =>
  sanitizeRedirectPath(`${requestUrl.pathname}${requestUrl.search}`);

export const buildLoginUrl = (requestUrl: URL): URL => {
  const loginUrl = new URL("/login", requestUrl);
  loginUrl.searchParams.set(
    RETURN_TO_PARAM_NAME,
    buildReturnToPath(requestUrl)
  );
  return loginUrl;
};
