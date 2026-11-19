/** One row of the creator role list, in the tenant's own priority order. */
export interface CreatorRoleListItem {
  id: string;
  name: string;
}

/**
 * What the list card's heading is addressable as.
 *
 * The list takes its accessible name from that heading with
 * `aria-labelledby` rather than from an `aria-label` of its own, so the name
 * is the copy already on screen and the list needs no string resolved for it.
 */
export const CREATOR_ROLE_LIST_TITLE_ID = "creator-role-list-title";

/** Result of a reorder, which the list submits rather than a form. */
export interface CreatorRoleReorderResult {
  ok: boolean;
  message?: string;
}
