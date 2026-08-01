import {
  buildPublicSessionHeaders,
  createPublicGrpcApiClient,
  PUBLIC_SESSION_COOKIE_NAME,
} from "@publira/public-web-shared";
import { cookies, headers } from "next/headers";

export const apiClient = createPublicGrpcApiClient();

export const buildSessionHeaders = buildPublicSessionHeaders;

export const resolveSessionId = async (sessionId = ""): Promise<string> => {
  if (sessionId.length > 0) {
    return sessionId;
  }

  const cookieStore = await cookies();
  const cookieSessionId =
    cookieStore.get(PUBLIC_SESSION_COOKIE_NAME)?.value ?? "";
  if (cookieSessionId.length > 0) {
    return cookieSessionId;
  }

  const headerStore = await headers();
  return headerStore.get("x-publira-session-id") ?? "";
};
