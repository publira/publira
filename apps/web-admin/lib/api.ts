import { createAdminApiClient } from "@publira/api-client/admin/client";
import {
  createForwardedForInterceptor,
  FORWARDED_FOR_HEADER,
} from "@publira/api-client/forwarded-for";
import { headers } from "next/headers";

const readForwardedFor = async () => {
  const requestHeaders = await headers();
  return requestHeaders.get("x-forwarded-for");
};

// gRPC transport is used for internal Next.js -> Go API communication.
export const apiClient = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_GRPC_URL ?? "http://localhost:8100",
  interceptors: [createForwardedForInterceptor(readForwardedFor)],
  transport: "grpc",
});

type SessionCallOptions = NonNullable<
  Parameters<(typeof apiClient.auth)["getMe"]>[1]
>;

export const withSessionHeaders = (sessionId: string): SessionCallOptions => ({
  headers: { Authorization: `Bearer ${sessionId}` },
});

/**
 * Call options for a sessionless call the API holds against the client's
 * address: sign-in, a password reset, a multi-factor step before the session exists.
 * Only a call with a session gets the address from the interceptor.
 */
export const withClientAddressHeaders =
  async (): Promise<SessionCallOptions> => {
    const forwardedFor = await readForwardedFor();
    return forwardedFor
      ? { headers: { [FORWARDED_FOR_HEADER]: forwardedFor } }
      : {};
  };
