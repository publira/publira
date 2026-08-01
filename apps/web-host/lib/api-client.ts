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

import {
  getPublicSessionCacheTag,
  PUBLIC_SESSION_COOKIE_NAME,
} from "./auth-shared";

const DEFAULT_PUBLIC_GRPC_URL = "http://localhost:8100";

export const apiClient = createPublicApiClient({
  baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? DEFAULT_PUBLIC_GRPC_URL,
  transport: "grpc",
});

export const buildSessionHeaders = (accessToken: string) =>
  buildBearerHeaders(accessToken);

export const sealSessionCookieValue = (
  payload: WebSessionPayload
): Promise<string> => encryptSessionPayload(payload, resolveAuthSecret());

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

const getAccessTokenFromCookie = async (): Promise<string> => {
  "use cache: private";
  cacheLife({ stale: 30 });
  cacheTag(getPublicSessionCacheTag(PUBLIC_SESSION_COOKIE_NAME));

  const cookieStore = await cookies();
  const raw = cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
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
  if (looksLikeJwt(raw)) {
    return raw;
  }
  return "";
};

export const resolveAccessToken = (accessToken = ""): Promise<string> => {
  const token = accessToken.trim();
  if (token) {
    return Promise.resolve(token);
  }
  return getAccessTokenFromCookie();
};
