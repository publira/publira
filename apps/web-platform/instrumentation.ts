/**
 * Server startup hooks. Installs Temporal polyfill and registers OpenTelemetry
 * before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { registerTracing } from "@publira/tracing";

import { resolveWebServiceToken } from "./lib/web-service-token";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-platform");
  // Refuse to start rather than fail on the first shared read: every console
  // screen reads the platform's data with this token. Next.js does not call
  // `register` during `next build`, which runs without it.
  resolveWebServiceToken();
};
