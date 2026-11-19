import type { EpisodeNeighborItem } from "#lib/catalog";

/**
 * The next free episode the end of an episode offers beside the next one, or
 * `undefined` where it would only offer the next episode a second time.
 *
 * `GetEpisodeDetail` answers `next_free_episode` with the first later episode
 * whose body is public, so when the next episode is itself free the two name
 * the same episode. They are told apart by `publicId`, the one thing both
 * links are written from.
 */
export const laterFreeEpisode = (
  nextEpisode: EpisodeNeighborItem | undefined,
  nextFreeEpisode: EpisodeNeighborItem | undefined
): EpisodeNeighborItem | undefined =>
  nextFreeEpisode && nextFreeEpisode.publicId !== nextEpisode?.publicId
    ? nextFreeEpisode
    : undefined;
