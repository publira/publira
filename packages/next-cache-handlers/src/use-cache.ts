/**
 * Entry module for Next.js `cacheHandlers` (plural).
 *
 * next.config.ts:
 * ```ts
 * cacheHandlers: {
 *   default: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
 *   remote: import.meta.resolve("@publira/next-cache-handlers/use-cache"),
 * }
 * ```
 *
 * Both `default` (`"use cache"`) and `remote` (`"use cache: remote"`) point at
 * the same Redis-backed handler so multi-instance deployments share one store.
 * `"use cache: private"` is not configurable by Next.js.
 */
import { createUseCacheHandler } from "./use-cache-handler";

const handler = createUseCacheHandler();

export default handler;
