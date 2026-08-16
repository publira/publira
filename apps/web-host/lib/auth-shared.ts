import { isUnauthenticatedRpcError } from "@publira/api-client/errors";
import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";

export const PUBLIC_SESSION_COOKIE_NAME = "publira_web_host_auth";

const PUBLIC_SESSION_CACHE_TAG_PREFIX = "public-session-cookie";

export const getPublicSessionCacheTag = (cookieName: string): string =>
  `${PUBLIC_SESSION_CACHE_TAG_PREFIX}-${cookieName}`;

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
  returnTo: string | null | undefined,
  options?: { revoked?: boolean }
): string => {
  const params = new URLSearchParams({
    returnTo: sanitizeRedirectPath(returnTo),
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

export const buildLoginUrl = (
  requestUrl: URL,
  options?: {
    returnToParamName?: string;
    tenantId?: string;
  }
): URL => {
  const { returnToParamName = "returnTo", tenantId } = options ?? {};

  const loginUrl = tenantId
    ? new URL(`/${tenantId}/login`, requestUrl)
    : new URL("/login", requestUrl);

  const returnToPath = sanitizeRedirectPath(
    `${requestUrl.pathname}${requestUrl.search}`
  );
  loginUrl.searchParams.set(returnToParamName, returnToPath);
  return loginUrl;
};
