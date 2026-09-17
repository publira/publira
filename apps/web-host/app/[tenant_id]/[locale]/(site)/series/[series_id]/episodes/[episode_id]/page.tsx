import { toIntlLocale } from "@publira/i18n";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { cn, DEFAULT_TIME_ZONE, formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import type { ReactNode } from "react";
import { z } from "zod";

import { ContentViewTracker } from "#components/content-view-tracker";
import { CreatorCredits } from "#components/creator-credits";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getEpisodeDetail, getSeriesDetail } from "#lib/catalog";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { resolveOpenGraphImage } from "#lib/open-graph";
import { shareText } from "#lib/share-text";
import {
  getTenantPublicOrigin,
  getTenantSiteInfo,
  getTenantSiteLabel,
} from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";
import { tenantLocaleUrl } from "#lib/tenant-locale-path";

import { CheckoutNotice } from "./_components/checkout-notice";
import { EpisodeBody } from "./_components/episode-body";
import { EpisodeEndPanel } from "./_components/episode-end-panel";
import { EpisodeRatingGate } from "./_components/episode-rating-gate";
import {
  COMMENT_TOKEN_PARAM,
  parseCommentSearchParams,
} from "./_lib/comment-search-params";
import { episodePath } from "./_lib/episode-path";
import { episodeDisplayTitle } from "./_lib/episode-title";
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

/**
 * The card a link to this episode unfurls into, and the `<title>` above it.
 *
 * The episode names itself the way its running head does, and the work's own
 * words and artwork stand behind it: an episode carries neither a synopsis nor
 * an eye-catch of its own anywhere in the data model. Both reads are
 * `"use cache"` and keyed on their arguments, so passing what the page body
 * passes costs one RPC each for the two of them.
 */
export const generateMetadata = async (
  props: PageProps<"/[tenant_id]/[locale]/series/[series_id]/episodes/[episode_id]">
): Promise<Metadata> => {
  const [rawParams, tenantId, locale] = await Promise.all([
    props.params,
    getTenantId(),
    getLocale(),
  ]);
  const parsedParams = parseRouteParams(episodeDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { episode_id, series_id } = parsedParams;

  const [result, seriesResult, url, origin, siteLabel, t] = await Promise.all([
    getEpisodeDetail(tenantId, series_id, episode_id, locale),
    getSeriesDetail(tenantId, series_id, locale),
    tenantLocaleUrl(tenantId, locale, episodePath(series_id, episode_id)),
    getTenantPublicOrigin(tenantId),
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  // As on the series page: an episode that is missing, unpublished, or
  // unreadable keeps the site label the `(site)` layout puts in the document
  // title, and unfurls no card of its own.
  const detail = result.ok ? result.value : undefined;
  if (!detail) {
    return {};
  }

  const { episode, series } = detail;
  const title = episodeDisplayTitle(t, episode);
  // Both from the series: an episode carries neither a synopsis nor an
  // eye-catch of its own, and `GetEpisodeDetail` answers with the work's id,
  // title, and rating rather than its artwork.
  const work = seriesResult.ok ? seriesResult.value?.series : undefined;
  const description = work?.synopsis.trim() || undefined;
  const image = origin
    ? resolveOpenGraphImage(origin, work?.eyeCatchImageVariants, series.title)
    : undefined;

  return {
    description,
    openGraph: {
      description,
      images: image,
      siteName: siteLabel,
      title,
      type: "article",
      url: url ?? undefined,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: image,
      title,
    },
  };
};

/** The page under the reader, which is one column of ordinary text. */
const EpisodeColumn = ({ children }: { children: ReactNode }) => (
  <div className="mx-auto grid max-w-6xl gap-10 px-6 py-10">{children}</div>
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
  const checkoutSessionId =
    purchaseSearchParams.checkout === "success"
      ? purchaseSearchParams.session_id
      : "";

  // Missing / unpublished / other-series / other-tenant episodes resolve to
  // `null`, and the public site must not tell those apart. A failed read is a
  // value as well: a `"use cache"` fill that throws fails the whole request,
  // so nothing downstream would get to render.
  //
  // The catalog is awaited here for one string: the body section names itself
  // as a landmark, and an `aria-label` cannot be a node. Everything else on
  // this page streams its own copy in through `<Message>`.
  const [result, seriesResult, tenant, t] = await Promise.all([
    getEpisodeDetail(tenantId, series_id, episode_id, locale),
    getSeriesDetail(tenantId, series_id, locale),
    getTenantSiteInfo(tenantId),
    getMessagesFor(locale),
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
  // A share names the work, not the instalment — which one it is, is what the
  // address and the card carry. `GetEpisodeDetail` answers with the work's id,
  // title, and rating rather than its credits, so the names come from the
  // series read beside it, and a read that failed leaves the title on its own.
  const workCredits =
    seriesResult.ok && seriesResult.value
      ? seriesResult.value.series.credits
      : [];
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
    <EpisodeRatingGate
      access={access}
      checkoutSessionId={checkoutSessionId}
      episodePublicId={episode.publicId}
      locale={locale}
      rating={series.ageRating}
      seriesPublicId={series.publicId}
      seriesTitle={series.title}
      tenantId={tenantId}
    >
      <main>
        <ContentViewTracker kind="episode" publicId={episode.publicId} />
        {/* The reader opens the page: everything else is what the reader may
          want after finishing, so it sits below the pages rather than above
          them. */}
        <section
          aria-label={t("host.episode.body_label")}
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
                checkoutSessionId={checkoutSessionId}
                commentMode={commentMode}
                commentToken={commentSearchParams[COMMENT_TOKEN_PARAM]}
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
          <CheckoutNotice checkout={purchaseSearchParams.checkout} />

          {/* A running head: which instalment this is. The number is part of
            the title line rather than a chip beside it, because a serial
            numbers its instalments the way a book numbers its chapters. The
            work is not named again here — the panel below ends on the link
            back to it. */}
          <header className="grid gap-2">
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
            {/* Who made this instalment. The episode's own credits, not the
              series' — an artist who took over part way through is on the
              episodes they drew and on none of the ones before them. */}
            {episode.credits.length > 0 && (
              <p className="text-sm">
                <CreatorCredits credits={episode.credits} locale={locale} />
              </p>
            )}
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
            nextEpisode={nextEpisode}
            previousEpisode={previousEpisode}
            series={series}
            shareText={shareText(t, locale, series.title, workCredits)}
            shareTitle={episodeDisplayTitle(t, episode)}
            tenantId={tenantId}
          />
        </EpisodeColumn>
      </main>
    </EpisodeRatingGate>
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
