import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";

const ADMIN_SESSION_CACHE_TAG = "admin-session-cookie";

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

/**
 * Returns the API access token from the encrypted browser session cookie.
 */
export const getAccessToken = async (): Promise<string> => {
  "use cache: private";
  cacheLife({ stale: 30 });
  cacheTag(ADMIN_SESSION_CACHE_TAG);

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
