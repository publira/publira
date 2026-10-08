/**
 * Server startup hooks. Installs Temporal polyfill, registers OpenTelemetry,
 * and appends the address each request arrives from to its forwarded headers
 * before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { registerTracing } from "@publira/tracing";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-host");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { appendPeerAddressOnEveryRequest } =
      await import("@publira/api-client/forwarded-hop");
    appendPeerAddressOnEveryRequest();
  }
};
