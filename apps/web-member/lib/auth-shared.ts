import {
  buildPublicLoginUrl,
  PUBLIC_SESSION_COOKIE_NAME,
  sanitizeRedirectPath,
} from "@publira/public-web-shared";

export { PUBLIC_SESSION_COOKIE_NAME, sanitizeRedirectPath };

export const buildLoginUrl = (requestUrl: URL): URL =>
  buildPublicLoginUrl(requestUrl);
