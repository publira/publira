import {
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cacheLife, cacheTag, io } from "next/cache";
import { cookies } from "next/headers";

import { ADMIN_SESSION_COOKIE_NAME } from "./admin-auth-shared";

const ADMIN_SESSION_CACHE_TAG = "admin-session-cookie";

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

const getAccessTokenFromCookie = async (): Promise<string> => {
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

/**
 * Returns the API access token from the encrypted browser session cookie.
 *
 * `await io()` marks the caller as I/O so the following gRPC call is excluded
 * from the static shell. Without it the transport's internal `Date.now()`
 * (`@connectrpc/connect-node` HTTP/2 session manager) is reported as an
 * unstable value during prerender. Inside a `"use cache"` scope it is a no-op.
 * @see https://nextjs.org/docs/app/api-reference/functions/io
 */
export const getAccessToken = async (): Promise<string> => {
  await io();
  return await getAccessTokenFromCookie();
};
