/**
 * Server startup hooks. Installs Temporal polyfill before handling requests.
 * Client-side counterpart: instrumentation-client.ts
 * @see https://github.com/publira/publira/issues/573
 */
export const register = async () => {
  await import("temporal-polyfill/global");
};
