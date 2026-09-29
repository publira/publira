import type { EpisodeItem } from "#lib/catalog";
import type { SeriesProgressItem } from "#lib/reading-progress";

export interface ContinueOffer {
  episodePublicId: string;
  /**
   * Whether the offer picks up where the reader stopped. It decides which of
   * the two labels the reading action carries, so the words follow the episode
   * rather than the reader's state: a reader who has read the series to its
   * end is offered the beginning again, and offered it as a beginning.
   */
  isContinuation: boolean;
}

const startOffer = (episode: EpisodeItem): ContinueOffer => ({
  episodePublicId: episode.publicId,
  isContinuation: false,
});

/**
 * The episode the series page's one reading action opens, and whether it
 * continues a reading or starts one.
 *
 * `GetMySeriesProgress` answers with the episode the reader last moved in and
 * whether they finished it, which is four offers rather than two. A reader who
 * stopped inside an episode is sent back into it; one who finished it is sent
 * to the next episode published after it; one who has opened nothing, and one
 * who has finished the last episode there is, are invited into the first.
 * `episodes` is therefore the series' published list in ascending order, which
 * is the order the page prints it in.
 *
 * `null` means there is nothing to offer at all: a series with no published
 * episodes, which is also the one state the page has no reading action in.
 */
export const resolveContinueOffer = (
  episodes: EpisodeItem[],
  progress: SeriesProgressItem | null
): ContinueOffer | null => {
  const [first] = episodes;
  if (!first) {
    return null;
  }

  if (!progress) {
    return startOffer(first);
  }

  if (!progress.isFinished) {
    return {
      episodePublicId: progress.episode.publicId,
      isContinuation: true,
    };
  }

  const next = episodes.find(
    (episode) => episode.orderIndex > progress.episode.orderIndex
  );
  return next
    ? { episodePublicId: next.publicId, isContinuation: true }
    : startOffer(first);
};
