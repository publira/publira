import {
  buildPublicSessionHeaders,
  createPublicGrpcApiClient,
  PUBLIC_SESSION_COOKIE_NAME,
  resolvePublicAccessToken,
} from "@publira/public-web-shared";

export const apiClient = createPublicGrpcApiClient();

export const buildSessionHeaders = buildPublicSessionHeaders;

export const resolveAccessToken = (accessToken = ""): Promise<string> =>
  resolvePublicAccessToken(PUBLIC_SESSION_COOKIE_NAME, accessToken);
