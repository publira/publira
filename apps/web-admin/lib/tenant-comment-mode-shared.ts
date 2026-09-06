/**
 * How the tenant publishes the comments its readers write. The stored
 * `tenant_config.comment_mode` values rather than the generated enum, so the
 * settings form, the `FormData` it submits, and the catalog keys naming each
 * option are all the same three strings.
 *
 * Kept apart from `tenant-comment-mode.ts` because the settings card is a
 * Client Component: importing the value from the module that reads the session
 * would pull `next/headers` into the browser graph.
 */
export type TenantCommentMode = "approval_required" | "disabled" | "immediate";

/** The order the settings card offers: off, then the two ways of being on. */
export const TENANT_COMMENT_MODES = [
  "disabled",
  "immediate",
  "approval_required",
] as const satisfies readonly TenantCommentMode[];

export const isTenantCommentMode = (
  value: string
): value is TenantCommentMode =>
  TENANT_COMMENT_MODES.some((mode) => mode === value);
