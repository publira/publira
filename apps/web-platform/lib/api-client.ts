import { createPlatformApiClient } from "@publira/api-client/platform/client";
import {
  buildBearerHeaders,
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cacheTag, io } from "next/cache";
import { cookies } from "next/headers";

import {
  PLATFORM_SESSION_CACHE_TAG,
  PLATFORM_SESSION_COOKIE_NAME,
} from "./auth-shared";

// gRPC transport is used for internal Next.js → Go API communication
const grpcBaseUrl =
  process.env.PUBLIRA_PLATFORM_GRPC_URL ?? "http://localhost:8102";

export const apiClient = createPlatformApiClient({
  baseUrl: grpcBaseUrl,
  transport: "grpc",
});

export const buildSessionHeaders = (accessToken: string) =>
  buildBearerHeaders(accessToken);

const looksLikeJwt = (value: string): boolean => value.split(".").length === 3;

const getAccessTokenFromCookie = async (): Promise<string> => {
  "use cache: private";
  cacheTag(PLATFORM_SESSION_CACHE_TAG);

  const cookieStore = await cookies();
  const raw =
    cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
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

/**
 * Session token for per-user (uncached) RPC.
 *
 * `await io()` marks the caller as I/O so the following gRPC call is excluded
 * from the static shell. Without it the transport's internal `Date.now()`
 * (`@connectrpc/connect-node` HTTP/2 session manager) is reported as an
 * unstable value during prerender. Inside a `"use cache"` scope it is a no-op.
 * @see https://nextjs.org/docs/app/api-reference/functions/io
 */
export const resolveAccessToken = async (accessToken = ""): Promise<string> => {
  await io();

  const token = accessToken.trim();
  if (token) {
    return token;
  }

  return await getAccessTokenFromCookie();
};
