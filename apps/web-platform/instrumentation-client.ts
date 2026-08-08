/**
 * Client instrumentation: runs after document load and before React hydration.
 * Static import so Temporal is available before any component code runs.
 * Server-side counterpart: instrumentation.ts
 * @see https://github.com/publira/publira/issues/573
 */
import "temporal-polyfill/global";
