import { getMessage, toIntlLocale } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, DEFAULT_TIME_ZONE, formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { AgeRatingGate } from "#components/age-rating-gate";
import { ContentViewTracker } from "#components/content-view-tracker";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  getEpisodeDetail,
  getSeriesDetail,
  isPublicEpisodeBody,
} from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { EpisodeBody } from "./_components/episode-body";
import { EpisodeComments } from "./_components/episode-comments";
import { EpisodeEndPanel } from "./_components/episode-end-panel";
import {
  COMMENT_TOKEN_PARAM,
  parseCommentSearchParams,
} from "./_lib/comment-search-params";
import { parsePurchaseSearchParams } from "./_lib/purchase-search-params";
import { VIEWER_HEIGHT_CLASS } from "./_lib/viewer-layout";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

const episodeDetailParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

/** Both neighbours, which is the most the section under the pages holds. */
const NEIGHBOR_SKELETON_COUNT = 2;

/** Two rows of comments, which is what a phone shows of the list at once. */
const COMMENT_SKELETON_COUNT = 2;

/** The page under the reader, which is one column of ordinary text. */
const EpisodeColumn = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10">{children}</div>
);

const CommentsSkeleton = () => (
  <div className="grid gap-4">
    <SkeletonLine className="h-6 w-32" />
    <div className="divide-y divide-border border-t border-border">
      {Array.from({ length: COMMENT_SKELETON_COUNT }, (_, index) => (
        <div className="grid gap-2 py-4" key={index}>
          <SkeletonLine className="h-4 w-32" />
          <SkeletonLine className="h-4 w-full max-w-(--measure-prose)" />
        </div>
      ))}
    </div>
  </div>
);

const EpisodeBodySkeleton = () => (
  <div
    aria-busy="true"
    className={cn(VIEWER_HEIGHT_CLASS, "w-full animate-pulse bg-foreground")}
  />
);

const EpisodeSkeleton = () => (
  <div>
    <EpisodeBodySkeleton />
    <EpisodeColumn>
      <div className="grid gap-2">
        <SkeletonLine className="h-4 w-40" />
        <Skeleton className="h-9 w-2/3" />
        <SkeletonLine className="h-4 w-1/2" />
      </div>
      <div className="grid gap-4">
        <SkeletonLine className="h-6 w-40" />
        <div className="divide-y divide-border border-y border-border">
          {Array.from({ length: NEIGHBOR_SKELETON_COUNT }, (_, index) => (
            <div className="flex items-center gap-3 py-3" key={index}>
              <span className="w-2 shrink-0" />
              <Skeleton className="aspect-16/9 w-24 shrink-0 rounded-control" />
              <SkeletonLine className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </div>
    </EpisodeColumn>
  </div>
);

const EpisodeContent = async (
  props: PageProps<"/[tenant_id]/[locale]/series/[series_id]/episodes/[episode_id]">
) => {
  const [rawParams, tenantId, searchParams, locale] = await Promise.all([
    props.params,
    getTenantId(),
    props.searchParams,
    getLocale(),
  ]);
  const parsedParams = parseRouteParams(episodeDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { episode_id, series_id } = parsedParams;
  const purchaseSearchParams = parsePurchaseSearchParams(searchParams);
  const commentSearchParams = parseCommentSearchParams(searchParams);

  // Missing / unpublished / other-series / other-tenant episodes resolve to
  // `null`, and the public site must not tell those apart. A failed read is a
  // value as well: a `"use cache"` fill that throws fails the whole request,
  // so nothing downstream would get to render.
  //
  // The catalog is awaited here for one string: the body section names itself
  // as a landmark, and an `aria-label` cannot be a node. Everything else on
  // this page streams its own copy in through `<Message>`.
  const [result, seriesResult, tenant, messages] = await Promise.all([
    getEpisodeDetail(tenantId, series_id, episode_id, locale),
    getSeriesDetail(tenantId, series_id, locale),
    getTenantSiteInfo(tenantId),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { access, episode, images, nextEpisode, previousEpisode, series } =
    result.value;
  // GetSeriesDetail resolves a series override against the tenant default.
  // If that read failed, do not offer a form whose submission might be
  // rejected; the next request retries the uncached failure value.
  const commentMode =
    seriesResult.ok && seriesResult.value
      ? seriesResult.value.series.commentMode
      : "disabled";
  // The site-info read resolves the tenant zone. The fallback only covers an
  // unavailable tenant read, never the host machine's local zone.
  const timeZone = tenant?.timeZone ?? DEFAULT_TIME_ZONE;
  // Empty where the episode carries no such moment, and the colophon leaves
  // the fact out rather than standing "Not set" where a date would be.
  const publishedAt = formatDateTime(episode.publishedAt, {
    fallback: "",
    locale,
    timeZone,
  });
  const scheduledAt = formatDateTime(episode.scheduledAt, {
    fallback: "",
    locale,
    timeZone,
  });

  return (
    <AgeRatingGate
      backHref={`/series/${series.publicId}`}
      backMessage="host.episode.to_series_detail"
      rating={series.ageRating}
      seriesTitle={series.title}
    >
      <main>
        <ContentViewTracker kind="episode" publicId={episode.publicId} />
        {/* The reader opens the page: everything else is what the reader may
          want after finishing, so it sits below the pages rather than above
          them. */}
        <section
          aria-label={getMessage(messages, "host.episode.body_label")}
          className="border-b border-border"
        >
          <SectionErrorBoundary
            title={
              <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                <Message message="host.episode.body_error" />
              </Suspense>
            }
          >
            <Suspense fallback={<EpisodeBodySkeleton />}>
              <EpisodeBody
                access={access}
                acceptsPayments={tenant?.acceptsPayments ?? false}
                checkoutSessionId={
                  purchaseSearchParams.checkout === "success"
                    ? purchaseSearchParams.session_id
                    : ""
                }
                episode={episode}
                images={images}
                nextEpisode={nextEpisode}
                previousEpisode={previousEpisode}
                series={series}
                tenantId={tenantId}
              />
            </Suspense>
          </SectionErrorBoundary>
        </section>

        <EpisodeColumn>
          {purchaseSearchParams.checkout === "success" ? (
            <output className="block rounded-control border border-success px-4 py-3 text-sm text-success">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="host.episode.checkout_success" />
              </Suspense>
            </output>
          ) : null}
          {purchaseSearchParams.checkout === "cancelled" ? (
            <output className="block rounded-control border border-warning px-4 py-3 text-sm text-warning">
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="host.episode.checkout_cancelled" />
              </Suspense>
            </output>
          ) : null}
          {purchaseSearchParams.checkout === "error" ? (
            <p
              className="block rounded-control border border-destructive px-4 py-3 text-sm text-destructive"
              role="alert"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-full" />}>
                <Message message="host.episode.checkout_error" />
              </Suspense>
            </p>
          ) : null}

          {/* A running head: which work this is, then which instalment of it.
            The number is part of the title line rather than a chip beside it,
            because a serial numbers its instalments the way a book numbers its
            chapters. */}
          <header className="grid gap-2">
            <p className="text-sm text-muted-foreground">
              <LocaleLink
                className="underline underline-offset-4"
                href={`/series/${series.publicId}`}
              >
                {series.title}
              </LocaleLink>
            </p>
            <h1 className="font-serif text-3xl leading-tight">
              <span className="tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-7 w-28" />}>
                  <Message
                    message="host.common.episode_number"
                    values={{ number: episode.orderIndex }}
                  />
                </Suspense>
              </span>{" "}
              {episode.title}
            </h1>
            {/* The colophon: what the episode costs, when it appeared, how much
              of it there is, and how long it stays open. */}
            <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="tabular-nums">
                {episode.price > 0 ? (
                  `¥${episode.price.toLocaleString(toIntlLocale(locale))}`
                ) : (
                  <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
                    <Message message="host.common.free" />
                  </Suspense>
                )}
              </span>
              {publishedAt ? (
                <span className="tabular-nums">
                  <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
                    <Message
                      message="host.episode.published"
                      values={{ date: publishedAt }}
                    />
                  </Suspense>
                </span>
              ) : null}
              {images.length > 0 ? (
                <span className="tabular-nums">
                  <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
                    <Message
                      message="host.episode.page_count_value"
                      values={{ count: images.length }}
                    />
                  </Suspense>
                </span>
              ) : null}
              <span className="tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                  <Message message="host.episode.reading_period" />{" "}
                  {episode.readingPeriodHours > 0 ? (
                    <Message
                      message="host.episode.reading_period_hours"
                      values={{ hours: episode.readingPeriodHours }}
                    />
                  ) : (
                    <Message message="host.episode.reading_period_unlimited" />
                  )}
                </Suspense>
              </span>
              {scheduledAt ? (
                <span className="tabular-nums">
                  <Suspense fallback={<SkeletonLine className="h-4 w-44" />}>
                    <Message message="host.episode.scheduled_at" />
                  </Suspense>{" "}
                  {scheduledAt}
                </span>
              ) : null}
            </p>
          </header>

          {/* Directly under the running head, because finishing the pages is
            when a reader decides whether to keep going. */}
          <EpisodeEndPanel
            episode={episode}
            marksNextEpisode={isPublicEpisodeBody(access)}
            nextEpisode={nextEpisode}
            previousEpisode={previousEpisode}
            series={series}
            tenantId={tenantId}
          />

          {commentMode === "disabled" ? null : (
            <SectionErrorBoundary
              title={
                <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
                  <Message message="host.episode.comments.list_error" />
                </Suspense>
              }
            >
              {/* Its own boundary, so the pages and the episode metadata above
                reach the reader without waiting on the comment reads. */}
              <Suspense fallback={<CommentsSkeleton />}>
                <EpisodeComments
                  commentMode={commentMode}
                  episodePublicId={episode.publicId}
                  seriesPublicId={series.publicId}
                  tenantId={tenantId}
                  token={commentSearchParams[COMMENT_TOKEN_PARAM]}
                />
              </Suspense>
            </SectionErrorBoundary>
          )}
        </EpisodeColumn>
      </main>
    </AgeRatingGate>
  );
};

const Page = (
  props: PageProps<"/[tenant_id]/[locale]/series/[series_id]/episodes/[episode_id]">
) => (
  <Suspense fallback={<EpisodeSkeleton />}>
    <EpisodeContent {...props} />
  </Suspense>
);

export default Page;
