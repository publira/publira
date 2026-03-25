// web-member uses the same session cookie as web-public
export const PUBLIC_SESSION_COOKIE_NAME = "publira_public_session";

export const sanitizeRedirectPath = (
  path: string | null | undefined
): string => {
  if (!path || !path.startsWith("/")) {
    return "/";
  }

  // 自サイト内へのリダイレクトのみ許可
  // //で始まる場合や /login で始まる場合は拒否
  if (path.startsWith("//") || path.startsWith("/login")) {
    return "/";
  }

  return path;
};

export const buildLoginUrl = (requestUrl: URL): URL => {
  const loginUrl = new URL("/login", requestUrl);
  const returnToPath = `${requestUrl.pathname}${requestUrl.search}`;
  loginUrl.searchParams.set("returnTo", returnToPath);
  return loginUrl;
};
