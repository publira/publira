import {
  buildPublicSessionHeaders,
  createPublicGrpcApiClient,
  PUBLIC_SESSION_COOKIE_NAME,
  resolvePublicSessionId,
} from "@publira/public-web-shared";

export const apiClient = createPublicGrpcApiClient();

export const buildSessionHeaders = buildPublicSessionHeaders;

export const resolveSessionId = (sessionId?: string): Promise<string> =>
  resolvePublicSessionId(PUBLIC_SESSION_COOKIE_NAME, sessionId);
