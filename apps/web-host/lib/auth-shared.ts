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

  if (path.startsWith("//") || path.startsWith("/login")) {
    return "/";
  }

  return path;
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

  const returnToPath = `${requestUrl.pathname}${requestUrl.search}`;
  loginUrl.searchParams.set(returnToParamName, returnToPath);
  return loginUrl;
};
