import { getMessage, toIntlLocale } from "@publira/i18n";
import { CollectionIcon } from "@publira/icons";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { FollowControlSkeleton } from "#components/follow-button";
import { FollowControl } from "#components/follow-control";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getSeriesDetail } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const seriesDetailParamsSchema = z.object({
  series_id: routeParamString(),
});

const SeriesDetailSkeleton = () => (
  <div className="mx-auto max-w-5xl px-6 py-12">
    <div className="mb-10 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <div className="aspect-3/4 animate-pulse rounded-2xl bg-muted" />
      <div className="space-y-4">
        <div className="h-9 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="h-20 w-full animate-pulse rounded bg-muted" />
      </div>
    </div>
    <div className="grid gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          className="h-16 animate-pulse rounded-lg border border-border/70 bg-muted/40"
          key={index}
        />
      ))}
    </div>
  </div>
);

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
  // page nor any boundary would get to render anything (#672).
  const [result, messages] = await Promise.all([
    getSeriesDetail(tenantId, series_id, locale),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { episodes, series } = result.value;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-8">
        <LocaleLink
          href="/series"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.series.back_to_list")}
        </LocaleLink>
      </nav>

      <div className="mb-10 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        {series.eyeCatchImageVariants &&
        series.eyeCatchImageVariants.length > 0 ? (
          <div className="overflow-hidden rounded-2xl bg-muted shadow-sm">
            <div className="aspect-3/4 overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={series.title}
                imgClassName="h-full w-full object-cover"
                preferredType="portrait"
                sizes="(max-width: 1024px) 100vw, 280px"
                variants={series.eyeCatchImageVariants}
              />
            </div>
          </div>
        ) : (
          <div className="flex aspect-3/4 items-center justify-center rounded-2xl bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50 shadow-sm">
            <CollectionIcon className="h-16 w-16" />
          </div>
        )}

        <div>
          <div className="mb-8">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-4">
              <h1 className="font-serif text-4xl font-bold">{series.title}</h1>
              <SectionErrorBoundary
                description={
                  <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                    <Message message="host.errors.page_description" />
                  </Suspense>
                }
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
            {series.creatorNames.length > 0 && (
              <p className="mb-2 text-muted-foreground">
                {series.creatorNames.join("、")}
              </p>
            )}
            {series.labelName &&
              (series.labelPublicId ? (
                <LocaleLink
                  href={`/labels/${series.labelPublicId}`}
                  className="inline-block rounded-full bg-accent/15 px-3 py-0.5 text-xs font-medium text-accent transition hover:bg-accent/25"
                >
                  {series.labelName}
                </LocaleLink>
              ) : (
                <span className="inline-block rounded-full bg-accent/15 px-3 py-0.5 text-xs font-medium text-accent">
                  {series.labelName}
                </span>
              ))}
          </div>

          {series.synopsis && (
            <p className="max-w-2xl whitespace-pre-wrap text-muted-foreground">
              {series.synopsis}
            </p>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold">
          {getMessage(messages, "host.series.episodes_heading")}
        </h2>
        {episodes.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            {getMessage(messages, "host.series.episodes_empty")}
          </p>
        ) : (
          <ol className="grid gap-3">
            {episodes.map((ep) => (
              <li key={ep.publicId}>
                <LocaleLink
                  href={`/series/${series.publicId}/episodes/${ep.publicId}`}
                  className="group flex items-center gap-4 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:border-accent/40 hover:shadow-md"
                >
                  <span className="min-w-8 text-center text-sm font-medium text-muted-foreground tabular-nums">
                    {ep.orderIndex}
                  </span>
                  <span className="flex-1 font-medium transition-colors group-hover:text-secondary">
                    {ep.title}
                  </span>
                  {ep.price > 0 ? (
                    <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-sm font-medium text-warning">
                      ¥{ep.price.toLocaleString(toIntlLocale(locale))}
                    </span>
                  ) : (
                    <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-sm font-medium text-success">
                      {getMessage(messages, "host.common.free")}
                    </span>
                  )}
                </LocaleLink>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
};

const Page = (props: PageProps<"/[tenant_id]/[locale]/series/[series_id]">) => (
  <Suspense fallback={<SeriesDetailSkeleton />}>
    <SeriesDetailContent {...props} />
  </Suspense>
);

export default Page;
