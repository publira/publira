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

export const buildLoginUrl = (requestUrl: URL): URL =>
  buildPublicLoginUrl(requestUrl);
