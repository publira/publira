import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import { Suspense } from "react";

import { Message } from "#components/message";
import type { EpisodeItem } from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getMySeriesProgress } from "#lib/reading-progress";
import type { SeriesProgressItem } from "#lib/reading-progress";

import { resolveContinueOffer } from "../_lib/continue-offer";

/**
 * Where this reader stands in the series, or nowhere when that could not be
 * established.
 *
 * A failure ends here rather than propagating. Every row of the episode list
 * reads the same request-memoized answer, so a failure that threw would take
 * the whole list down over a decoration on one of its rows; the reading action
 * above the list makes the same read and answers a failure by pointing at the
 * first episode.
 */
const readSeriesProgress = async (
  tenantId: string,
  seriesPublicId: string,
  locale: Locale
): Promise<{
  finishedEpisodePublicIds: string[];
  progress: SeriesProgressItem | null;
  signedIn: boolean;
}> => {
  const empty = {
    finishedEpisodePublicIds: [],
    progress: null,
    signedIn: false,
  };

  try {
    const result = await getMySeriesProgress(tenantId, seriesPublicId, locale);
    return result.ok
      ? {
          finishedEpisodePublicIds: result.finishedEpisodePublicIds,
          progress: result.progress,
          signedIn: result.signedIn,
        }
      : empty;
  } catch {
    return empty;
  }
};

/** The width the mark keeps whether or not a dot lands in it. */
const markClassName = cn("flex w-2 shrink-0 justify-center");

/**
 * The empty mark, which is what a guest and a reader with nothing read get,
 * and what stands at the head of a row while the private read is in flight.
 * The column is there either way, so the rows stay aligned on one left edge
 * and none of them moves when the answer arrives.
 */
export const EpisodeReadMarkPlaceholder = () => (
  <span aria-hidden="true" className={markClassName} />
);

/**
 * The Shu dot at the head of one row of the episode list, on the episode this
 * reader is being sent to next — the same episode the reading action above the
 * list opens, so the two say one thing rather than two. It is the one place a
 * screen is allowed a second Shu.
 *
 * The mark also carries the row's read state as a data attribute, which is
 * what turns a finished row grey: the row is public and streams from the
 * shared cache, so nothing inside it can be coloured by a read the page makes
 * privately, but a row can be told to answer to a mark that arrives later.
 */
export const EpisodeReadMark = async ({
  episodePublicId,
  episodes,
  seriesPublicId,
  tenantId,
}: {
  episodePublicId: string;
  episodes: EpisodeItem[];
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const { finishedEpisodePublicIds, progress, signedIn } =
    await readSeriesProgress(tenantId, seriesPublicId, locale);

  if (!signedIn) {
    return <EpisodeReadMarkPlaceholder />;
  }

  const isFinished = finishedEpisodePublicIds.includes(episodePublicId);
  const offer = resolveContinueOffer(episodes, progress);
  const isNext = !isFinished && offer?.episodePublicId === episodePublicId;

  return (
    <span className={markClassName} data-finished={isFinished || undefined}>
      {isNext && (
        <>
          <span
            aria-hidden="true"
            className="size-2 rounded-full bg-secondary"
          />
          <span className="sr-only">
            <Suspense fallback={null}>
              <Message message="host.series.next_to_read" />
            </Suspense>
          </span>
        </>
      )}
    </span>
  );
};

/**
 * Says in words what the grey row says in ink: this reader has finished this
 * episode. A guest, and a reader who has finished nothing, render nothing —
 * the row is complete without the marker, and there is no useful thing to say
 * in its place.
 */
export const EpisodeReadMarker = async ({
  episodePublicId,
  seriesPublicId,
  tenantId,
}: {
  episodePublicId: string;
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const { finishedEpisodePublicIds } = await readSeriesProgress(
    tenantId,
    seriesPublicId,
    locale
  );

  if (!finishedEpisodePublicIds.includes(episodePublicId)) {
    return null;
  }

  return (
    <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
      <Message message="host.series.episode_finished" />
    </Suspense>
  );
};
