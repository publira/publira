import { createPublicApiClient } from "@publira/api-client/public/client";
import type { WebSessionPayload } from "@publira/web-session";
import {
  buildBearerHeaders,
  decryptSessionPayload,
  encryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cacheLife, cacheTag } from "next/cache";
import { cookies } from "next/headers";

import { PUBLIC_SESSION_COOKIE_NAME } from "./auth-shared";

const DEFAULT_PUBLIC_GRPC_URL = "http://localhost:8100";
const PUBLIC_SESSION_CACHE_TAG_PREFIX = "public-session-cookie";

export const createPublicGrpcApiClient = () =>
  createPublicApiClient({
    baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? DEFAULT_PUBLIC_GRPC_URL,
    transport: "grpc",
  });

export const buildPublicSessionHeaders = (accessToken: string) =>
  buildBearerHeaders(accessToken);

export const getPublicSessionCacheTag = (cookieName: string): string =>
  `${PUBLIC_SESSION_CACHE_TAG_PREFIX}-${cookieName}`;

export const sealPublicSessionCookieValue = (
  payload: WebSessionPayload
): Promise<string> => encryptSessionPayload(payload, resolveAuthSecret());

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

const getAccessTokenFromCookie = async (
  cookieName: string
): Promise<string> => {
  "use cache: private";
  cacheLife({ stale: 30 });
  cacheTag(getPublicSessionCacheTag(cookieName));

  const cookieStore = await cookies();
  const raw = cookieStore.get(cookieName)?.value?.trim() ?? "";
  if (!raw) {
    return "";
  }

  // Prefer JWE payload; fall back to raw JWT for transitional cookies.
  const payload = await decryptSessionPayload(raw, resolveAuthSecret());
  if (payload) {
    if (isSessionExpired(payload.expiresAt)) {
      return "";
    }
    return payload.accessToken.trim();
  }
  if (looksLikeJwt(raw)) {
    return raw;
  }
  return "";
};

/** Resolve the API access token from an explicit value or the browser session cookie. */
export const resolvePublicAccessToken = (
  cookieName = PUBLIC_SESSION_COOKIE_NAME,
  accessToken = ""
): Promise<string> => {
  const token = accessToken.trim();
  if (token) {
    return Promise.resolve(token);
  }

  return getAccessTokenFromCookie(cookieName);
};

/** @deprecated Use resolvePublicAccessToken */
export const resolvePublicSessionId = resolvePublicAccessToken;
