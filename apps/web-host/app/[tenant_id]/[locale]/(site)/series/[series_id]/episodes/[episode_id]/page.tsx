import { getMessage, toIntlLocale } from "@publira/i18n";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { DEFAULT_TIME_ZONE, formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { ContentViewTracker } from "#components/content-view-tracker";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getEpisodeDetail, isPublicEpisodeBody } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { EpisodeBody } from "./_components/episode-body";
import { parsePurchaseSearchParams } from "./_lib/purchase-search-params";
import { VIEWER_HEIGHT_CLASS } from "./_lib/viewer-layout";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

const episodeDetailParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

const EpisodeBodySkeleton = () => (
  <div
    aria-busy="true"
    className={`${VIEWER_HEIGHT_CLASS} w-full animate-pulse bg-neutral-900`}
  />
);

const EpisodeSkeleton = () => (
  <div>
    <EpisodeBodySkeleton />
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <div className="h-40 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        <div className="space-y-4">
          <div className="h-32 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
          <div className="h-48 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        </div>
      </div>
    </div>
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

  // Missing / unpublished / other-series / other-tenant episodes resolve to
  // `null`, and the public site must not tell those apart. A failed read is a
  // value as well: a `"use cache"` fill that throws fails the whole request,
  // so nothing downstream would get to render (#672).
  const [result, tenant, messages] = await Promise.all([
    getEpisodeDetail(tenantId, series_id, episode_id, locale),
    getTenantSiteInfo(tenantId),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { access, episode, images, series } = result.value;
  // The site-info read resolves the tenant zone. The fallback only covers an
  // unavailable tenant read, never the host machine's local zone.
  const timeZone = tenant?.timeZone ?? DEFAULT_TIME_ZONE;
  const priceLabel =
    episode.price > 0
      ? `¥${episode.price.toLocaleString(toIntlLocale(locale))}`
      : getMessage(messages, "host.common.free");
  const unsetLabel = getMessage(messages, "host.common.unset");

  return (
    <main>
      <ContentViewTracker kind="episode" publicId={episode.publicId} />
      {/* The reader opens the page: everything else is what the reader may
          want after finishing, so it sits below the pages rather than above
          them. */}
      <section
        aria-label={getMessage(messages, "host.episode.body_label")}
        className="border-b border-border/70"
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
              seriesPublicId={series.publicId}
              tenantId={tenantId}
            />
          </Suspense>
        </SectionErrorBoundary>
      </section>

      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
        {purchaseSearchParams.checkout === "success" ? (
          <output className="mb-6 block rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
            {getMessage(messages, "host.episode.checkout_success")}
          </output>
        ) : null}
        {purchaseSearchParams.checkout === "cancelled" ? (
          <output className="mb-6 block rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            {getMessage(messages, "host.episode.checkout_cancelled")}
          </output>
        ) : null}
        {purchaseSearchParams.checkout === "error" ? (
          <p
            className="mb-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            {getMessage(messages, "host.episode.checkout_error")}
          </p>
        ) : null}

        <nav className="mb-8 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <LocaleLink
            className="underline-offset-4 hover:underline"
            href="/series"
          >
            {getMessage(messages, "host.series.list_title")}
          </LocaleLink>
          <span>／</span>
          <LocaleLink
            className="underline-offset-4 hover:underline"
            href={`/series/${series.publicId}`}
          >
            {getMessage(messages, "host.episode.series_detail")}
          </LocaleLink>
        </nav>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          <article>
            <header className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-8">
              <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="rounded-full bg-muted px-3 py-1 font-medium tabular-nums">
                  #{episode.orderIndex}
                </span>
                <span
                  className={
                    episode.price > 0
                      ? "rounded-full bg-warning/15 px-3 py-1 font-medium text-warning"
                      : "rounded-full bg-success/15 px-3 py-1 font-medium text-success"
                  }
                >
                  {priceLabel}
                </span>
                <span>
                  {getMessage(messages, "host.episode.published", {
                    date: formatDateTime(episode.publishedAt, {
                      fallback: unsetLabel,
                      locale,
                      timeZone,
                    }),
                  })}
                </span>
              </div>
              <h1 className="mb-3 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
                {episode.title}
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base">
                {getMessage(messages, "host.episode.series_note", {
                  title: series.title,
                })}
              </p>
            </header>
          </article>

          <aside className="space-y-4">
            <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                Series
              </p>
              <h2 className="mb-3 font-serif text-2xl font-semibold">
                {series.title}
              </h2>
              <LocaleLink
                href={`/series/${series.publicId}`}
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                {getMessage(messages, "host.episode.to_series_detail")}
              </LocaleLink>
            </section>

            <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                Episode Info
              </p>
              <dl className="space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {getMessage(messages, "host.episode.price")}
                  </dt>
                  <dd
                    className={
                      episode.price > 0
                        ? "font-medium text-warning"
                        : "font-medium text-success"
                    }
                  >
                    {priceLabel}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {getMessage(messages, "host.episode.published_on")}
                  </dt>
                  <dd className="text-right font-medium">
                    {formatDateTime(episode.publishedAt, {
                      fallback: unsetLabel,
                      locale,
                      timeZone,
                    })}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {getMessage(messages, "host.episode.reading_period")}
                  </dt>
                  <dd className="text-right font-medium">
                    {episode.readingPeriodHours > 0
                      ? getMessage(
                          messages,
                          "host.episode.reading_period_hours",
                          { hours: episode.readingPeriodHours }
                        )
                      : getMessage(
                          messages,
                          "host.episode.reading_period_unlimited"
                        )}
                  </dd>
                </div>
                {isPublicEpisodeBody(access) ? (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {getMessage(messages, "host.episode.page_count")}
                    </dt>
                    <dd className="font-medium">
                      {getMessage(messages, "host.episode.page_count_value", {
                        count: images.length,
                      })}
                    </dd>
                  </div>
                ) : null}
                {episode.scheduledAt && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">
                      {getMessage(messages, "host.episode.scheduled_at")}
                    </dt>
                    <dd className="text-right font-medium">
                      {formatDateTime(episode.scheduledAt, {
                        fallback: unsetLabel,
                        locale,
                        timeZone,
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          </aside>
        </div>
      </div>
    </main>
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
