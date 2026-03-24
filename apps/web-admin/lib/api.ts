import { createAdminApiClient } from "@publira/api-client/admin/client";

// gRPC transport is used for internal Next.js -> Go API communication.
export const apiClient = createAdminApiClient({
  baseUrl: process.env.PUBLIRA_ADMIN_GRPC_URL ?? "http://localhost:8101",
  transport: "grpc",
});

type SessionCallOptions = NonNullable<
  Parameters<(typeof apiClient.auth)["getMe"]>[1]
>;

export const withSessionHeaders = (sessionId: string): SessionCallOptions => ({
  headers: { "X-Publira-Session-Id": sessionId },
});
