/**
 * The bound `BulkEditEpisodeCredits` enforces: every named episode stays
 * locked until the transaction commits, so one correction cannot hold a
 * whole series. The console refuses a wider selection before the RPC would.
 */
export const MAX_BULK_EPISODE_CREDIT_EPISODES = 1000;

/**
 * The checked episodes, in the list's reading order.
 *
 * The list is already in display order (`order_index`). A later reorder
 * would make a span of indexes name a different set than the boxes that
 * were checked, so the RPC is given public ids, and this walk is what
 * puts them back into reading order.
 */
export const episodesSelectedInReadingOrder = <T extends { publicId: string }>(
  episodes: readonly T[],
  selectedPublicIds: readonly string[]
): T[] => {
  const selected = new Set(selectedPublicIds);
  return episodes.filter((episode) => selected.has(episode.publicId));
};
