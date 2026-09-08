import type { EpisodeItem } from "#lib/catalog";
import type { HostMessageKey } from "#lib/locale";
import type { SeriesProgressItem } from "#lib/reading-progress";

export interface ContinueOffer {
  episodePublicId: string;
  label: HostMessageKey;
  /** The episode number the label names, as the episode list prints it. */
  orderIndex: number;
}

const startOffer = (episode: EpisodeItem): ContinueOffer => ({
  episodePublicId: episode.publicId,
  label: "host.series.progress_start",
  orderIndex: episode.orderIndex,
});

/**
 * The episode a signed-in reader's call to action opens, and which of the two
 * labels names it.
 *
 * `GetMySeriesProgress` answers with the episode the reader last moved in and
 * whether they finished it, which is three offers rather than two. A reader
 * who stopped inside an episode is sent back into it; one who finished it is
 * sent to the next episode published after it; one who has opened nothing is
 * invited into the first. `episodes` is therefore the series' published list
 * in ascending order, which is the order the page prints it in.
 *
 * `null` means there is nothing to offer: a series with no published episodes,
 * or a reader who has finished the last one and is waiting for the next.
 */
export const resolveContinueOffer = (
  episodes: EpisodeItem[],
  progress: SeriesProgressItem | null
): ContinueOffer | null => {
  if (!progress) {
    const [first] = episodes;
    return first ? startOffer(first) : null;
  }

  if (!progress.isFinished) {
    return {
      episodePublicId: progress.episode.publicId,
      label: "host.series.progress_continue",
      orderIndex: progress.episode.orderIndex,
    };
  }

  const next = episodes.find(
    (episode) => episode.orderIndex > progress.episode.orderIndex
  );
  return next ? startOffer(next) : null;
};
