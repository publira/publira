import { createAdminApiClient } from "@publira/api-client/admin/client";
import {
  createForwardedInterceptor,
  forwardedHeadersOf,
  serviceCallContextValues,
} from "@publira/api-client/forwarded";
import { headers } from "next/headers";

import { resolveWebServiceToken } from "./web-service-token";

const readForwardedHeaders = async () => {
  const requestHeaders = await headers();

  return forwardedHeadersOf(requestHeaders);
};

// gRPC transport is used for internal Next.js -> Go API communication.
export const apiClient = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_GRPC_URL ?? "http://localhost:8000/rpc",
  interceptors: [createForwardedInterceptor(readForwardedHeaders)],
  transport: "grpc",
});

type SessionCallOptions = NonNullable<
  Parameters<(typeof apiClient.auth)["getMe"]>[1]
>;

export const withSessionHeaders = (sessionId: string): SessionCallOptions => ({
  headers: { Authorization: `Bearer ${sessionId}` },
});

/** Where the API reads the step-up token `Reauthenticate` answers. */
const STEP_UP_HEADER_NAME = "Publira-Step-Up";

/**
 * {@link withSessionHeaders} with the step-up token the session earned, for
 * the RPCs whose proto comment says "Requires a recent re-authentication". An
 * empty token sends the session alone, which those RPCs refuse with the reason
 * `REAUTHENTICATION_REQUIRED`.
 */
export const withStepUpHeaders = (
  sessionId: string,
  stepUpToken: string
): SessionCallOptions =>
  stepUpToken
    ? {
        headers: {
          Authorization: `Bearer ${sessionId}`,
          [STEP_UP_HEADER_NAME]: stepUpToken,
        },
      }
    : withSessionHeaders(sessionId);

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
    const forwarded = await readForwardedHeaders();

    return { headers: forwarded };
  };
