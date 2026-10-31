/**
 * The `[tenant_id]` segment is always written by `proxy.ts` from
 * `GetTenantByDomain`, so it is always a tenant UUID. Anything else means the
 * request never went through the proxy, and every tenant RPC then fails with
 * "tenant_id must be a valid UUID". `proxy.ts` answers the one path that used
 * to arrive that way, `/favicon.ico`, before it reaches the tree; this guard
 * is what keeps the next such path from doing the same damage.
 *
 * Kept free of `next/navigation` and `next/root-params` so Route Handlers can
 * import it too.
 */
const TENANT_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Whether `next/root-params` resolved the segment to one value. Its type says
 * it always does; checking keeps a missing segment a 404 rather than a crash.
 */
export const isRootParamValue = (value: unknown): value is string =>
  typeof value === "string";

export const isTenantIdFormat = (value: string): boolean =>
  TENANT_ID_PATTERN.test(value.trim().toLowerCase());
