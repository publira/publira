import { cacheLife } from "next/cache";

/**
 * Result of a read that runs inside a `"use cache"` scope.
 *
 * `value` keeps the read's own shape, so a helper that answers `null` for
 * "missing" still answers `null` here — `ok: false` means "we could not find
 * out", which is a different thing from "there is nothing".
 */
export type CachedReadResult<TValue> =
  | { message: string; ok: false }
  | { ok: true; value: TValue };

/**
 * Keep the surrounding `"use cache"` entry out of the cache.
 *
 * Call it on the failure path of a cached read, before returning the failure
 * value. `expire: 0` makes the entry unstorable for
 * `@publira/next-cache-handlers` (its `set` skips `expire === 0` in
 * production), and `revalidate: 0` makes anything that did get stored read back
 * as a miss — two independent guards, so a recovered API shows normal content
 * on the next request instead of a cached failure.
 */
export const dropFailedCacheEntry = (): void => {
  try {
    cacheLife({ expire: 0, revalidate: 0, stale: 0 });
  } catch {
    // Unit tests call these reads without the Next.js cache runtime, the same
    // way `applyCacheTag` tolerates a missing `cacheTag` scope.
  }
};

/**
 * The failure half of `CachedReadResult`, with the entry dropped.
 *
 * ```ts
 * export const getSeriesDetail = async (…) => {
 *   "use cache";
 *   try {
 *     …
 *   } catch (error) {
 *     if (isMissingResourceRpcError(error)) {
 *       return { ok: true, value: null }; // missing is an answer, and cacheable
 *     }
 *     return cachedReadFailure(rpcErrorMessage(error, "…"));
 *   }
 * };
 * ```
 *
 * **A `"use cache"` function must not throw.** Measured against the production
 * build under Cache Components (#672): when a cache fill throws, Next.js fails
 * the request that triggered it — an awaiting `try` / `catch` around the call
 * does not save it, and neither does an outer cached function catching an inner
 * one. The response is a bare `500 Internal Server Error` document unless a
 * static shell has already been committed, in which case, and only then, the
 * failure streams into the nearest client error boundary
 * (`SectionErrorBoundary`) and the rest of the page survives.
 *
 * Every route in these apps sits under a dynamic `[tenant_id]` root segment, so
 * "has a committed shell" is not a property a `lib/` helper can assume: the
 * same read is awaited by a page section inside `<Suspense>` (shell committed)
 * and by `generateMetadata` or a detail page body that awaits before anything
 * is flushed (no shell). Returning the failure as a value is what works in both
 * places, so it is the rule for all of them.
 *
 * Classification stays **inside** the cache scope, which is the other reason
 * this shape is the one that works: Next.js re-creates an error that crossed a
 * `"use cache"` boundary from its name and message, and production replaces the
 * message with a digest, so `Code` — and with it `rpcErrorDisposition()` and
 * `rpcErrorMessage()` — is gone by the time an outside `catch` sees it. Build
 * the message here, where the `ConnectError` is still intact.
 */
export const cachedReadFailure = <TValue = never>(
  message: string
): CachedReadResult<TValue> => {
  dropFailedCacheEntry();
  return { message, ok: false };
};
