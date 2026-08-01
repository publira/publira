import { createPublicApiClient } from "@publira/api-client/public/client";
import {
  buildBearerHeaders,
  decryptSessionPayload,
  encryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
  type WebSessionPayload,
} from "@publira/web-session";
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

export const sealPublicSessionCookieValue = async (
  payload: WebSessionPayload
): Promise<string> => encryptSessionPayload(payload, resolveAuthSecret());

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

const getAccessTokenFromCookie = async (cookieName: string): Promise<string> => {
  // Avoid "use cache" here so a cookie set during login is visible on the next request.
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

export const resolvePublicSessionId = (
  cookieName = PUBLIC_SESSION_COOKIE_NAME,
  accessToken?: string
): Promise<string> => {
  const token = (accessToken ?? "").trim();
  if (token) {
    return Promise.resolve(token);
  }

  return getAccessTokenFromCookie(cookieName);
};
