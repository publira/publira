/**
 * What the pack list's heading is addressable as, so the list takes its
 * accessible name from the copy already on screen.
 */
export const COIN_PACK_LIST_TITLE_ID = "coin-pack-list-title";

/** Result of a reorder, which the list submits rather than a form. */
export interface CoinPackReorderResult {
  ok: boolean;
  message?: string;
}
