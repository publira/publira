import { toIntlLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { EpisodeReactionControlSkeleton } from "#components/episode-reaction-button";
import { EpisodeReactionControl } from "#components/episode-reaction-control";
import { EyeCatchFrame } from "#components/eye-catch-frame";
import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import {
  RelatedSeries,
  RelatedSeriesSkeleton,
} from "#components/related-series";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import type {
  EpisodeDetail,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale } from "#lib/locale";

import { episodePath } from "../_lib/episode-path";

/**
 * Three covers, one row on a phone. The panel sits under the pages a reader
 * just finished, so it suggests rather than lists.
 */
const RELATED_SERIES_COUNT = 3;

/**
 * One of the episodes either side of this one, as a row of the same shape the
 * series page lists episodes in: the work's artwork, the number, the title,
 * and what it costs.
 *
 * Episodes carry no artwork of their own anywhere in the data model, so every
 * row shows the series' eye-catch; what tells the two rows apart is the label
 * above the title and, on the next one, the mark.
 */
const EpisodeNeighborRow = ({
  directionLabel,
  episode,
  locale,
  marked,
  series,
}: {
  /** Which side of this episode the row leads to, in the reader's words. */
  directionLabel: ReactNode;
  episode: EpisodeNeighborItem;
  locale: Locale;
  /** Whether this row carries the page's one Shu. */
  marked: boolean;
  series: EpisodeSeriesSummary;
}) => (
  <li>
    <LocaleLink
      className="group flex items-center gap-3 py-3"
      href={episodePath(series.publicId, episode.publicId)}
    >
      {/* The column is there on both rows, so neither moves when only one of
          them is marked. The mark says what the label beside it already says
          in words, so it is a drawing rather than something to read out. */}
      <span aria-hidden="true" className="flex w-2 shrink-0 justify-center">
        {marked && <span className="size-2 rounded-full bg-secondary" />}
      </span>
      <EyeCatchFrame
        alt=""
        className="aspect-16/9 w-24 shrink-0 rounded-control"
        preferredType="landscape"
        sizes="96px"
        variants={series.eyeCatchImageVariants}
      />
      <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
        <span className="grid min-w-0 flex-1 gap-1">
          <span className="text-sm text-muted-foreground">
            {directionLabel}
          </span>
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              <Suspense fallback={<SkeletonLine className="h-4 w-10" />}>
                <Message
                  message="host.common.episode_number"
                  values={{ number: episode.orderIndex }}
                />
              </Suspense>
            </span>
            {/* Wrapped rather than truncated, as on the series page: on a
                phone the row leaves the title too little width to clip it. */}
            <span className="line-clamp-2 underline-offset-4 group-hover:underline">
              {episode.title}
            </span>
          </span>
        </span>
        <span className="mt-1 block text-sm text-muted-foreground tabular-nums sm:mt-0 sm:w-56 sm:shrink-0">
          {episode.isFree ? (
            <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
              <Message message="host.common.free" />
            </Suspense>
          ) : (
            `¥${episode.price.toLocaleString(toIntlLocale(locale))}`
          )}
        </span>
      </span>
    </LocaleLink>
  </li>
);

/**
 * What the reader is offered once the pages run out: the episodes either side
 * of this one, and — at the end of the series — the news that there is none
 * after it and the control that asks to be told when there is.
 *
 * It is an ordinary element under the reader rather than an extra page inside
 * it, so the page count the viewer reports and the last page the read beacon
 * watches for are the ones the episode actually has. That also keeps it out of
 * the locked body: an episode nobody may read still ends somewhere, and the
 * series is still the way on from it.
 */
export const EpisodeEndPanel = async ({
  episode,
  marksNextEpisode,
  nextEpisode,
  previousEpisode,
  series,
  tenantId,
}: {
  episode: EpisodeDetail;
  /**
   * Whether the next episode is what this reader does next, which on a screen
   * whose body is open it is. Where the body is gated the one Shu belongs to
   * the action that opens it, and the row carries no mark.
   */
  marksNextEpisode: boolean;
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  /** Absent on the first one. */
  previousEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
  tenantId: string;
}) => {
  const locale = await getLocale();

  const returnTo = episodePath(series.publicId, episode.publicId);

  return (
    <div className="grid gap-10">
      <div className="justify-self-start">
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.episode.reaction.control_error" />
            </Suspense>
          }
        >
          {/* Member-specific, so it sits in a boundary of its own: the
              section around it stays on the shared public cache. */}
          <Suspense fallback={<EpisodeReactionControlSkeleton />}>
            <EpisodeReactionControl
              episodePublicId={episode.publicId}
              ratingCount={episode.ratingCount}
              returnTo={returnTo}
              seriesPublicId={series.publicId}
              tenantId={tenantId}
            />
          </Suspense>
        </SectionErrorBoundary>
      </div>

      {previousEpisode || nextEpisode ? (
        <section className="grid gap-4">
          <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-5 w-40" />}>
              <Message message="host.episode.end.more_episodes" />
            </Suspense>
          </h2>
          <ol className="divide-y divide-border border-b border-border">
            {previousEpisode ? (
              <EpisodeNeighborRow
                directionLabel={
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="host.episode.navigation.previous" />
                  </Suspense>
                }
                episode={previousEpisode}
                locale={locale}
                marked={false}
                series={series}
              />
            ) : null}
            {nextEpisode ? (
              <EpisodeNeighborRow
                directionLabel={
                  <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                    <Message message="host.episode.navigation.next" />
                  </Suspense>
                }
                episode={nextEpisode}
                locale={locale}
                marked={marksNextEpisode}
                series={series}
              />
            ) : null}
          </ol>
        </section>
      ) : null}

      {nextEpisode ? null : (
        <section className="grid gap-3">
          <h2 className="font-serif text-xl leading-tight">
            <Suspense fallback={<SkeletonLine className="h-5 w-56" />}>
              <Message message="host.episode.end.up_to_date_title" />
            </Suspense>
          </h2>
          <p className="max-w-(--measure-prose) text-sm text-muted-foreground">
            <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
              <Message
                message="host.episode.end.up_to_date_description"
                values={{ title: series.title }}
              />
            </Suspense>
          </p>
          <div className="justify-self-start">
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.follow.control_error" />
                </Suspense>
              }
            >
              {/* Member-specific, so it sits in a boundary of its own: the
                  section around it stays on the shared public cache. */}
              <Suspense fallback={<FollowControlSkeleton />}>
                <FollowControl
                  publicId={series.publicId}
                  returnTo={returnTo}
                  targetKind="series"
                  targetName={series.title}
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </section>
      )}

      {/* Only where the series has run out. While there is a next episode the
          panel makes one offer, and a shelf of other works beside it is what
          turns that one offer into a choice.

          The section renders its own heading, so a read that fails takes the
          whole thing with it rather than leaving a heading over nothing; the
          boundary is still here for a throw, which is a defect rather than the
          unreachable API the section answers by disappearing. */}
      {nextEpisode ? null : (
        <SectionErrorBoundary
          title={
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.related.list_error" />
            </Suspense>
          }
        >
          <Suspense
            fallback={<RelatedSeriesSkeleton count={RELATED_SERIES_COUNT} />}
          >
            <RelatedSeries
              limit={RELATED_SERIES_COUNT}
              seriesPublicId={series.publicId}
              tenantId={tenantId}
            />
          </Suspense>
        </SectionErrorBoundary>
      )}

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href={`/series/${series.publicId}`}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="host.episode.end.back_to_series" />
          </Suspense>
        </LocaleLink>
      </p>
    </div>
  );
};
