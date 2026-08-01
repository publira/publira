import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";

const looksLikeJwt = (value: string): boolean => {
  const parts = value.split(".");
  // Compact JWE has 5 segments; JWT has 3.
  return parts.length === 3;
};

/**
 * Returns the API access token from the encrypted session cookie.
 * Does not use "use cache" so a cookie set during login is visible on the next request.
 */
export const getSessionId = async (): Promise<string> => {
  const cookieStore = await cookies();
  const raw = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
  if (!raw) {
    return "";
  }

  const payload = await decryptSessionPayload(raw, resolveAuthSecret());
  if (payload) {
    if (isSessionExpired(payload.expiresAt)) {
      return "";
    }
    return payload.accessToken.trim();
  }

  // Transitional fallback: raw JWT stored without JWE.
  if (looksLikeJwt(raw)) {
    return raw;
  }

  return "";
};
