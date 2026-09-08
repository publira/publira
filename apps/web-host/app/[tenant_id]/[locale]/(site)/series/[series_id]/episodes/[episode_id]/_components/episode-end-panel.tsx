import { getMessage, toIntlLocale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import type {
  EpisodeDetail,
  EpisodeNeighborItem,
  EpisodeSeriesSummary,
} from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";

import { episodePath } from "../_lib/episode-path";

/**
 * What the reader is offered once the pages run out: the next episode, or the
 * news that there is none yet and the control that asks to be told when there
 * is.
 *
 * It is an ordinary element under the reader rather than an extra page inside
 * it, so the page count the viewer reports and the last page the read beacon
 * watches for are the ones the episode actually has. That also keeps it out of
 * the locked body: an episode nobody may read still ends somewhere, and the
 * series is still the way on from it.
 */
export const EpisodeEndPanel = async ({
  episode,
  nextEpisode,
  series,
  tenantId,
}: {
  episode: EpisodeDetail;
  /** Absent on the last published episode of the series. */
  nextEpisode?: EpisodeNeighborItem;
  series: EpisodeSeriesSummary;
  tenantId: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);
  const seriesHref = `/series/${series.publicId}`;

  return (
    <section className="mb-8 rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-8">
      {nextEpisode ? (
        <div>
          <h2 className="font-serif text-2xl font-semibold">
            {getMessage(messages, "host.episode.end.up_next")}
          </h2>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span className="rounded-full bg-muted px-3 py-1 font-medium tabular-nums">
              #{nextEpisode.orderIndex}
            </span>
            <span
              className={
                nextEpisode.isFree
                  ? "rounded-full bg-success/15 px-3 py-1 font-medium text-success"
                  : "rounded-full bg-warning/15 px-3 py-1 font-medium text-warning"
              }
            >
              {nextEpisode.isFree
                ? getMessage(messages, "host.common.free")
                : `¥${nextEpisode.price.toLocaleString(toIntlLocale(locale))}`}
            </span>
          </div>
          <LocaleLink
            className="mt-2 block text-xl font-semibold underline-offset-4 hover:underline"
            href={episodePath(series.publicId, nextEpisode.publicId)}
          >
            {nextEpisode.title}
          </LocaleLink>
        </div>
      ) : (
        <div>
          <h2 className="font-serif text-2xl font-semibold">
            {getMessage(messages, "host.episode.end.up_to_date_title")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            {getMessage(messages, "host.episode.end.up_to_date_description", {
              title: series.title,
            })}
          </p>
          <div className="mt-4">
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.follow.control_error" />
                </Suspense>
              }
            >
              {/* Member-specific, so it sits in a boundary of its own: the
                  panel around it stays on the shared public cache. */}
              <Suspense fallback={<FollowControlSkeleton />}>
                <FollowControl
                  publicId={series.publicId}
                  returnTo={episodePath(series.publicId, episode.publicId)}
                  targetKind="series"
                  targetName={series.title}
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </div>
      )}
      <LocaleLink
        className="mt-6 inline-block text-sm font-medium text-accent underline-offset-4 hover:underline"
        href={seriesHref}
      >
        {getMessage(messages, "host.episode.end.back_to_series")}
      </LocaleLink>
    </section>
  );
};
