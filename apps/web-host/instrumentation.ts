/**
 * Server startup hooks. Refuses a PUBLIRA_REDIS_URL the cache handlers would
 * not use, installs Temporal polyfill, and registers OpenTelemetry before
 * handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { resolveCacheHandlerConfig } from "@publira/next-cache-handlers";
import { registerTracing } from "@publira/tracing";

export const register = async () => {
  // Next.js loads the cache handlers lazily, so a throw there would fail
  // requests instead of stopping the server.
  resolveCacheHandlerConfig();
  await import("temporal-polyfill/global");
  registerTracing("publira-web-host");
};
