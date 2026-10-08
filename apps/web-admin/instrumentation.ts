/**
 * Server startup hooks. Installs Temporal polyfill, registers OpenTelemetry,
 * and appends the address each request arrives from to its forwarded headers
 * before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { registerTracing } from "@publira/tracing";

import { resolveWebServiceToken } from "./lib/web-service-token";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-admin");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { appendPeerAddressOnEveryRequest } =
      await import("@publira/api-client/forwarded-hop");
    appendPeerAddressOnEveryRequest();
  }
  // Refuse to start rather than fail on the first catalog read: every console
  // screen reads the tenant's catalog with this token. Next.js does not call
  // `register` during `next build`, which runs without it.
  resolveWebServiceToken();
};
