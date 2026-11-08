/**
 * An RPC failure category that `./catalog` has shared wording for.
 *
 * It lives apart from `catalog.ts` so that the declarations `./catalog`
 * publishes from `src/__generated__/locale-message-types.d.ts` can name it
 * through the package root, whose built declarations never reach the locale
 * catalogs.
 */
export type SharedRpcDisposition =
  | "conflict"
  | "forbidden"
  | "invalid-argument"
  | "not-found"
  | "rate-limited"
  | "unauthenticated"
  | "unavailable";
