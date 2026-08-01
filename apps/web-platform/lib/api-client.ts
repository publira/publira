import { createPlatformApiClient } from "@publira/api-client/platform/client";
import {
  buildBearerHeaders,
  decryptSessionPayload,
  isSessionExpired,
  resolveAuthSecret,
} from "@publira/web-session";
import { cookies } from "next/headers";

import { PLATFORM_SESSION_COOKIE_NAME } from "./auth-shared";

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
  // Avoid "use cache" so a cookie set during login is visible on the next request.
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

export const resolveSessionId = (accessToken?: string): Promise<string> => {
  const token = (accessToken ?? "").trim();
  if (token) {
    return Promise.resolve(token);
  }

  return getAccessTokenFromCookie();
};
