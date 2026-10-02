import { createAdminApiClient } from "@publira/api-client/admin/client";
import {
  createForwardedForInterceptor,
  FORWARDED_FOR_HEADER,
  serviceCallContextValues,
} from "@publira/api-client/forwarded-for";
import { headers } from "next/headers";

import { resolveWebServiceToken } from "./web-service-token";

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
 * Call options for a read the console makes as itself: one of the admin API's
 * tenant-level reads, whose answer is the same for every operator of the
 * tenant and is therefore cached once for all of them in a `"use cache"`
 * scope. The API refuses this credential on everything else.
 *
 * It says nothing about who is looking, so the exported read calls
 * `verifyAdminSession` before the cached function it signs.
 */
export const withServiceHeaders = (): SessionCallOptions => ({
  contextValues: serviceCallContextValues(),
  headers: { Authorization: `Bearer ${resolveWebServiceToken()}` },
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
