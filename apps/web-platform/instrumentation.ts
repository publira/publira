/**
 * Server startup hooks. Installs Temporal polyfill and registers OpenTelemetry
 * before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { registerTracing } from "@publira/tracing";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-platform");
};
