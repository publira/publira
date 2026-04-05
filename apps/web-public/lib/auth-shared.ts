import {
  buildPublicLoginUrl,
  getPublicSessionCacheTag,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "@publira/public-web-shared";

export {
  getPublicSessionCacheTag,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
};

export const buildLoginUrl = (requestUrl: URL, tenantPublicId?: string): URL =>
  buildPublicLoginUrl(requestUrl, { tenantPublicId });

export const buildAuthUrl = (
  requestUrl: URL,
  tenantPublicId: string,
  path: string
): URL => {
  // web-auth への遷移URL を構築（テナント間遷移）
  const authUrl = new URL(`/${tenantPublicId}${path}`, requestUrl);
  const nextPath = `${requestUrl.pathname}${requestUrl.search}`;
  authUrl.searchParams.set("returnTo", nextPath);
  return authUrl;
};
