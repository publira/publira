export const PUBLIC_SESSION_COOKIE_NAME = "publira_public_session";

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

export const buildPublicLoginUrl = (
  requestUrl: URL,
  options?: {
    returnToParamName?: string;
    tenantPublicId?: string;
  }
): URL => {
  const { returnToParamName = "returnTo", tenantPublicId } = options ?? {};

  const loginUrl = tenantPublicId
    ? new URL(`/${tenantPublicId}/login`, requestUrl)
    : new URL("/login", requestUrl);

  const returnToPath = `${requestUrl.pathname}${requestUrl.search}`;
  loginUrl.searchParams.set(returnToParamName, returnToPath);
  return loginUrl;
};
