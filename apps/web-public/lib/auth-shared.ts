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

  // バージョン付きのカタログページなど特定パターンは許可
  // 例: /${tenant_public_id}/セクション, /privacy, /terms
  return path;
};

export const buildLoginUrl = (
  requestUrl: URL,
  tenantPublicId?: string
): URL => {
  const loginUrl = tenantPublicId
    ? new URL(`/${tenantPublicId}/login`, requestUrl)
    : new URL("/login", requestUrl);

  const nextPath = `${requestUrl.pathname}${requestUrl.search}`;
  loginUrl.searchParams.set("returnTo", nextPath);
  return loginUrl;
};

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
