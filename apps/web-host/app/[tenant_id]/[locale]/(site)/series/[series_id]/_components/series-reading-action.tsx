import { LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { EpisodeItem } from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getMySeriesProgress } from "#lib/reading-progress";

import { resolveContinueOffer } from "../_lib/continue-offer";

/**
 * The one Shu button on a series page: the way into the work.
 *
 * The page renders it twice — here, and as the fallback the surrounding
 * `<Suspense>` shows while the reader's progress is in flight — so the static
 * shell already carries the action a guest, and a member who has read nothing,
 * would be offered anyway. That is why the offer arrives as values rather than
 * being resolved inside: the page has the first episode without asking anyone
 * who is reading.
 */
export const ReadingActionLink = ({
  episodePublicId,
  isContinuation,
  seriesPublicId,
}: {
  episodePublicId: string;
  isContinuation: boolean;
  seriesPublicId: string;
}) => (
  <LinkButton
    render={
      <LocaleLink
        href={`/series/${seriesPublicId}/episodes/${episodePublicId}`}
      />
    }
    size="lg"
    variant="secondary"
  >
    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
      {isContinuation ? (
        <Message message="host.series.continue_reading" />
      ) : (
        <Message message="host.series.read_from_first" />
      )}
    </Suspense>
  </LinkButton>
);

/**
 * The same button, aimed at where this reader stopped.
 *
 * Member-specific, like the follow control beside it, so it belongs in its own
 * `<Suspense>`: the series detail around it stays on the shared public cache
 * and its static shell is unchanged.
 *
 * A failed read leaves the button pointing at the first episode rather than
 * replacing it with an error. The action is public and complete without the
 * private read — what the failure costs is the reader's place in the series,
 * and a page that answers "start here" is a better answer than one whose only
 * action has become a notice.
 */
export const SeriesReadingAction = async ({
  episodes,
  seriesPublicId,
  tenantId,
}: {
  episodes: EpisodeItem[];
  seriesPublicId: string;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const result = await getMySeriesProgress(tenantId, seriesPublicId, locale);
  const offer = resolveContinueOffer(
    episodes,
    result.ok ? result.progress : null
  );

  if (!offer) {
    return null;
  }

  return (
    <ReadingActionLink
      episodePublicId={offer.episodePublicId}
      isContinuation={offer.isContinuation}
      seriesPublicId={seriesPublicId}
    />
  );
};
