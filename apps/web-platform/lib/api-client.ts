import { createPlatformApiClient } from "@publira/api-client/platform/client";
import { cookies } from "next/headers";

import { PLATFORM_SESSION_COOKIE_NAME } from "./auth-shared";

const apiBaseUrl =
  process.env.PUBLIRA_PLATFORM_API_BASE_URL ?? "http://localhost:8002";

export const apiClient = createPlatformApiClient({
  baseUrl: apiBaseUrl,
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
