export const ADMIN_SESSION_COOKIE_NAME = "publira_web_admin_auth";

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

export const buildLoginUrl = (requestUrl: URL): URL => {
  const loginUrl = new URL("/login", requestUrl);
  const nextPath = `${requestUrl.pathname}${requestUrl.search}`;
  loginUrl.searchParams.set("next", nextPath);
  return loginUrl;
};
