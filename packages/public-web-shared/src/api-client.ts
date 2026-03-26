import { createPublicApiClient } from "@publira/api-client/public/client";
import { cacheLife } from "next/cache";
import { cookies } from "next/headers";

import { PUBLIC_SESSION_COOKIE_NAME } from "./auth-shared";

const DEFAULT_PUBLIC_GRPC_URL = "http://localhost:8100";

export const createPublicGrpcApiClient = () =>
  createPublicApiClient({
    baseUrl: process.env.PUBLIRA_PUBLIC_GRPC_URL ?? DEFAULT_PUBLIC_GRPC_URL,
    transport: "grpc",
  });

export const buildPublicSessionHeaders = (sessionId: string) =>
  ({ headers: { "X-Publira-Session-Id": sessionId } }) as never;

const getSessionIdFromCookie = async (cookieName: string): Promise<string> => {
  "use cache: private";
  cacheLife({ stale: 30 });

  const cookieStore = await cookies();
  return cookieStore.get(cookieName)?.value?.trim() ?? "";
};

export const resolvePublicSessionId = (
  cookieName = PUBLIC_SESSION_COOKIE_NAME,
  sessionId?: string
): Promise<string> => {
  const sid = (sessionId ?? "").trim();
  if (sid) {
    return Promise.resolve(sid);
  }

  return getSessionIdFromCookie(cookieName);
};
