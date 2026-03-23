import { createPlatformApiClient } from "@publira/api-client/platform/client";
import { cookies } from "next/headers";

import { PLATFORM_SESSION_COOKIE_NAME } from "./auth-shared";

// gRPC transport is used for internal Next.js → Go API communication
const grpcBaseUrl =
  process.env.PUBLIRA_PLATFORM_GRPC_URL ?? "http://localhost:8102";

export const apiClient = createPlatformApiClient({
  baseUrl: grpcBaseUrl,
  transport: "grpc",
});

export const buildSessionHeaders = (sessionId: string) =>
  ({ headers: { "X-Publira-Session-Id": sessionId } }) as never;

const getSessionIdFromCookie = async (): Promise<string> => {
  // "use cache: private";

  const cookieStore = await cookies();
  return cookieStore.get(PLATFORM_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
};

export const resolveSessionId = (sessionId?: string): Promise<string> => {
  const sid = (sessionId ?? "").trim();
  if (sid) {
    return Promise.resolve(sid);
  }

  return getSessionIdFromCookie();
};
