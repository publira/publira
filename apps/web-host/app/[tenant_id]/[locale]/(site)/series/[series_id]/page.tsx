import { toIntlLocale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatDate, formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ContentViewTracker } from "#components/content-view-tracker";
import { EyeCatchFrame } from "#components/eye-catch-frame";
import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { Prose } from "#components/prose";
import {
  RelatedSeries,
  RelatedSeriesSkeleton,
} from "#components/related-series";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getSeriesDetail } from "#lib/catalog";
import type { SeriesSerializationStatus } from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  EpisodeReadMark,
  EpisodeReadMarkPlaceholder,
  EpisodeReadMarker,
} from "./_components/episode-read-state";
import {
  ReadingActionLink,
  SeriesReadingAction,
} from "./_components/series-reading-action";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const seriesDetailParamsSchema = z.object({
  series_id: routeParamString(),
});

/** Half a screen of rows, which is what a phone shows of the list at once. */
const EPISODE_SKELETON_COUNT = 5;

/**
 * Four covers of what to read next. The page has the width for a full shelf,
 * but the episode list above is what a reader came here for, so the suggestions
 * stay a strip rather than a second catalogue.
 */
const RELATED_SERIES_COUNT = 4;

const SeriesDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10">
    <div className="grid gap-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-start sm:gap-8">
      <Skeleton className="aspect-3/4 w-40 rounded-surface sm:w-full" />
      <div className="grid gap-5">
        <div className="grid gap-2">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
        <Skeleton className="h-20 w-full max-w-(--measure-prose)" />
        <Skeleton className="h-10 w-48" />
      </div>
    </div>
    <div className="grid gap-4">
      <Skeleton className="h-6 w-32" />
      <div className="divide-y divide-border">
        {Array.from({ length: EPISODE_SKELETON_COUNT }, (_, index) => (
          <div className="flex items-center gap-3 py-3" key={index}>
            <EpisodeReadMarkPlaceholder />
            <Skeleton className="aspect-16/9 w-24 shrink-0 rounded-control" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  </div>
);

/**
 * Whether the series is still gaining episodes, in the tenant's own words. A
 * series whose status the tenant has not set says nothing at all rather than
 * standing a placeholder where the answer would be.
 */
const SeriesStatusText = ({
  status,
}: {
  status: SeriesSerializationStatus;
}) => {
  switch (status) {
    case "ongoing": {
      return <Message message="host.series.status_ongoing" />;
    }
    case "completed": {
      return <Message message="host.series.status_completed" />;
    }
    default: {
      return <Message message="host.series.status_hiatus" />;
    }
  }
};

const SeriesDetailContent = async (
  props: PageProps<"/[tenant_id]/[locale]/series/[series_id]">
) => {
  const [rawParams, tenantId, locale] = await Promise.all([
    props.params,
    getTenantId(),
    getLocale(),
  ]);
  const parsedParams = parseRouteParams(seriesDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { series_id } = parsedParams;

  // Missing / unpublished / other-tenant series all resolve to `null`, and the
  // public site must not tell those apart. A failed read is a value as well:
  // a `"use cache"` fill that throws fails the whole request, so neither this
  // page nor any boundary would get to render anything.
  const [result, timeZone] = await Promise.all([
    getSeriesDetail(tenantId, series_id, locale),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { episodes, series } = result.value;
  const [firstEpisode] = episodes;

  return (
    <main className="mx-auto grid max-w-6xl gap-10 px-6 py-10">
      <ContentViewTracker kind="series" publicId={series.publicId} />

      <div className="grid gap-6 sm:grid-cols-[15rem_minmax(0,1fr)] sm:items-start sm:gap-8">
        {/* The one image a series page is about, so it keeps its title as its
            alt text: the cover is what a reader recognizes the work by. */}
        <EyeCatchFrame
          alt={series.title}
          className="aspect-3/4 w-40 rounded-surface sm:w-full"
          fetchPriority="high"
          loading="eager"
          preferredType="portrait"
          sizes="(max-width: 640px) 160px, 240px"
          variants={series.eyeCatchImageVariants}
        >
          <span className="line-clamp-6 font-serif text-sm leading-tight text-muted-foreground">
            {series.title}
          </span>
        </EyeCatchFrame>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <h1 className="font-serif text-3xl leading-tight">
              {series.title}
            </h1>
            {series.creatorNames.length > 0 && (
              <p className="text-muted-foreground">
                {formatList(series.creatorNames, { locale })}
              </p>
            )}
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
              {series.labelName &&
                (series.labelPublicId ? (
                  <LocaleLink
                    className="text-primary underline underline-offset-4"
                    href={`/labels/${series.labelPublicId}`}
                  >
                    {series.labelName}
                  </LocaleLink>
                ) : (
                  <span>{series.labelName}</span>
                ))}
              {series.status && (
                <span>
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <SeriesStatusText status={series.status} />
                  </Suspense>
                </span>
              )}
              <span className="tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
                  <Message
                    message="host.series.episode_count"
                    values={{ count: episodes.length }}
                  />
                </Suspense>
              </span>
            </p>
          </div>

          {series.synopsis && <Prose locale={locale}>{series.synopsis}</Prose>}

          <div className="flex flex-wrap items-center gap-3">
            {firstEpisode && (
              <SectionErrorBoundary
                title={
                  <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                    <Message message="host.series.progress_error" />
                  </Suspense>
                }
              >
                <Suspense
                  fallback={
                    <ReadingActionLink
                      episodePublicId={firstEpisode.publicId}
                      isContinuation={false}
                      seriesPublicId={series.publicId}
                    />
                  }
                >
                  <SeriesReadingAction
                    episodes={episodes}
                    seriesPublicId={series.publicId}
                    tenantId={tenantId}
                  />
                </Suspense>
              </SectionErrorBoundary>
            )}
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.follow.control_error" />
                </Suspense>
              }
            >
              <Suspense fallback={<FollowControlSkeleton />}>
                <FollowControl
                  publicId={series.publicId}
                  returnTo={`/series/${series.publicId}`}
                  targetKind="series"
                  targetName={series.title}
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
          </div>
        </div>
      </div>

      <section className="grid gap-4">
        <h2 className="border-b border-border pb-2 font-serif text-xl leading-tight">
          <Suspense fallback={<SkeletonLine className="h-5 w-32" />}>
            <Message message="host.series.episodes_heading" />
          </Suspense>
        </h2>
        {episodes.length === 0 ? (
          <EmptyState>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="host.series.episodes_empty" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyState>
        ) : (
          <ol className="divide-y divide-border">
            {episodes.map((episode) => (
              <li key={episode.publicId}>
                <LocaleLink
                  className="group flex items-center gap-3 py-3 has-data-finished:text-muted-foreground"
                  href={`/series/${series.publicId}/episodes/${episode.publicId}`}
                >
                  <Suspense fallback={<EpisodeReadMarkPlaceholder />}>
                    <EpisodeReadMark
                      episodePublicId={episode.publicId}
                      episodes={episodes}
                      seriesPublicId={series.publicId}
                      tenantId={tenantId}
                    />
                  </Suspense>
                  {/* Episodes carry no artwork of their own, so the row shows
                      the work's: the picture says which series the row is
                      from, and the title beside it says which episode. */}
                  <EyeCatchFrame
                    alt=""
                    className="aspect-16/9 w-24 shrink-0 rounded-control"
                    preferredType="landscape"
                    sizes="96px"
                    variants={series.eyeCatchImageVariants}
                  />
                  <span className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
                    <span className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                        <Suspense
                          fallback={<SkeletonLine className="h-4 w-10" />}
                        >
                          <Message
                            message="host.common.episode_number"
                            values={{ number: episode.orderIndex }}
                          />
                        </Suspense>
                      </span>
                      {/* Wrapped rather than truncated: the title is what a
                          reader picks an episode by, and on a phone the row
                          leaves it too little width to clip it there. */}
                      <span className="line-clamp-2 underline-offset-4 group-hover:underline">
                        {episode.title}
                      </span>
                    </span>
                    <span className="mt-1 flex items-baseline justify-between gap-3 text-sm text-muted-foreground sm:mt-0 sm:w-56 sm:shrink-0">
                      <span className="flex items-baseline gap-3">
                        <span className="tabular-nums">
                          {episode.price > 0 ? (
                            `¥${episode.price.toLocaleString(toIntlLocale(locale))}`
                          ) : (
                            <Suspense
                              fallback={<SkeletonLine className="h-4 w-8" />}
                            >
                              <Message message="host.common.free" />
                            </Suspense>
                          )}
                        </span>
                        <Suspense fallback={null}>
                          <EpisodeReadMarker
                            episodePublicId={episode.publicId}
                            seriesPublicId={series.publicId}
                            tenantId={tenantId}
                          />
                        </Suspense>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatDate(episode.publishedAt, {
                          fallback: "",
                          locale,
                          timeZone,
                        })}
                      </span>
                    </span>
                  </span>
                </LocaleLink>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The section renders its own heading, because a read that fails takes
          the whole thing with it rather than leaving a heading over nothing.
          The boundary is still here for a throw, which is a defect rather than
          the unreachable API the section answers by disappearing. */}
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

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/series"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message message="host.series.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: PageProps<"/[tenant_id]/[locale]/series/[series_id]">) => (
  <Suspense fallback={<SeriesDetailSkeleton />}>
    <SeriesDetailContent {...props} />
  </Suspense>
);

export default Page;
