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
