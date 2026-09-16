/**
 * The bound `BulkEditEpisodeCredits` enforces: every named episode stays
 * locked until the transaction commits, so one correction cannot hold a
 * whole series. The console refuses a wider range before the RPC would.
 */
export const MAX_BULK_EPISODE_CREDIT_EPISODES = 1000;

/**
 * The episodes from `firstPublicId` to `lastPublicId`, inclusive, in the
 * list's reading order.
 *
 * The list is already in display order (`order_index`). The two ends are
 * found by public id rather than by that index, because a later reorder
 * would make an index span name a different set than the picker composed.
 * If the ends are given the other way around, the span is still the
 * episodes between them in reading order — the range is a pair of
 * endpoints, not a direction.
 */
export const episodesInInclusiveRange = <T extends { publicId: string }>(
  episodes: readonly T[],
  firstPublicId: string,
  lastPublicId: string
): T[] => {
  if (firstPublicId.length === 0 || lastPublicId.length === 0) {
    return [];
  }

  const firstIndex = episodes.findIndex(
    (episode) => episode.publicId === firstPublicId
  );
  const lastIndex = episodes.findIndex(
    (episode) => episode.publicId === lastPublicId
  );
  if (firstIndex === -1 || lastIndex === -1) {
    return [];
  }

  const start = Math.min(firstIndex, lastIndex);
  const end = Math.max(firstIndex, lastIndex);
  return episodes.slice(start, end + 1);
};
