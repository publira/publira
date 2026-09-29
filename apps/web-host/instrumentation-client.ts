/**
 * Client instrumentation: runs after document load and before React hydration.
 * Static import so Temporal is available before any component code runs.
 * Server-side counterpart: instrumentation.ts
 */
import "temporal-polyfill/global";
