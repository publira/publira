import { createPublicApiClient } from "@publira/api-client/public/client";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";

import { PUBLIC_SESSION_COOKIE_NAME } from "./auth-shared";

// gRPC transport is used for internal Next.js → Go API communication
const grpcBaseUrl =
  process.env.PUBLIRA_PUBLIC_GRPC_URL ?? "http://localhost:8100";

export const apiClient = createPublicApiClient({
  baseUrl: grpcBaseUrl,
  transport: "grpc",
});

export const buildSessionHeaders = (sessionId: string) =>
  ({ headers: { "X-Publira-Session-Id": sessionId } }) as never;

const getSessionIdFromCookie = async (): Promise<string> => {
  "use cache: private";
  cacheLife({ stale: 30 });

  const cookieStore = await cookies();
  return cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value?.trim() ?? "";
};

export const resolveSessionId = (sessionId?: string): Promise<string> => {
  const sid = (sessionId ?? "").trim();
  if (sid) {
    return Promise.resolve(sid);
  }

  return getSessionIdFromCookie();
};
