/**
 * Server startup hooks. Installs Temporal polyfill and registers OpenTelemetry
 * before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 */
import { registerTracing } from "@publira/tracing";

import { resolveWebServiceToken } from "./lib/web-service-token";

export const register = async () => {
  await import("temporal-polyfill/global");
  registerTracing("publira-web-admin");
  // Refuse to start rather than fail on the first catalog read: every console
  // screen reads the tenant's catalog with this token. Next.js does not call
  // `register` during `next build`, which runs without it.
  resolveWebServiceToken();
};
