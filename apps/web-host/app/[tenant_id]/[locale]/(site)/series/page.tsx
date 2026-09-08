import { getMessage } from "@publira/i18n";
import { CollectionIcon } from "@publira/icons";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  parseSeriesListSearchParams,
  seriesListHref,
} from "./_lib/search-params";

const SERIES_PAGE_SIZE = 24;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.series.list_title") };
};

const SeriesCardSkeleton = () => (
  <div className="overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm">
    <div className="mb-4 h-32 animate-pulse rounded bg-muted" />
    <div className="mb-1 h-5 w-3/4 animate-pulse rounded bg-muted" />
    <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
    <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
  </div>
);

const SeriesListSkeleton = () => (
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => (
      <SeriesCardSkeleton key={i} />
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const SeriesListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.series.list_description", {
    site: siteLabel,
  });
};

/**
 * Resolves the catalog itself rather than taking it as a prop: the labels are
 * three fixed strings and the `aria-label` cannot stream, and every caller
 * already sits inside the section's own boundary.
 */
const SeriesPagination = async ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.series.pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          href={seriesListHref(previousToken)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.common.previous_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.previous_page")}
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          href={seriesListHref(nextToken)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {getMessage(messages, "host.common.next_page")}
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          {getMessage(messages, "host.common.next_page")}
        </span>
      )}
    </nav>
  );
};

const SeriesListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/series">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseSeriesListSearchParams(resolvedSearchParams);

  const [result, messages] = await Promise.all([
    listPublishedSeries(tenantId, {
      limit: SERIES_PAGE_SIZE,
      locale,
      token,
    }),
    loadHostMessages(locale),
  ]);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.series.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!token) {
      return (
        <div className="py-20 text-center text-muted-foreground">
          {getMessage(messages, "host.series.list_empty")}
        </div>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          {getMessage(messages, "host.series.page_empty")}
        </p>
        {previousToken || nextToken ? (
          <SeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <LocaleLink
            href={seriesListHref("")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {getMessage(messages, "host.series.first_page")}
          </LocaleLink>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((item) => (
          <LocaleLink
            key={item.publicId}
            href={`/series/${item.publicId}`}
            className="group overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:border-secondary/40 hover:shadow-md"
          >
            {item.eyeCatchImageVariants &&
            item.eyeCatchImageVariants.length > 0 ? (
              <div className="aspect-video overflow-hidden bg-muted">
                <EyeCatchPicture
                  alt={item.title}
                  imgClassName="size-full object-cover"
                  preferredType="landscape"
                  variants={item.eyeCatchImageVariants}
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
                <CollectionIcon className="h-12 w-12" />
              </div>
            )}
            <div className="px-6 py-5">
              <h2 className="mb-1 font-serif text-lg font-semibold transition-colors group-hover:text-secondary">
                {item.title}
              </h2>
              {item.creatorNames.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {formatList(item.creatorNames, { locale })}
                </p>
              )}
              {item.labelName && (
                <p className="mt-1 inline-flex rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-medium text-accent">
                  {item.labelName}
                </p>
              )}
              {item.synopsis && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {item.synopsis}
                </p>
              )}
            </div>
          </LocaleLink>
        ))}
      </div>

      <SeriesPagination nextToken={nextToken} previousToken={previousToken} />
    </>
  );
};

const SeriesPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/series">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-56" />}>
        <Message message="host.series.list_title" />
      </Suspense>
    </h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
        <SeriesListDescription />
      </Suspense>
    </p>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.series.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<SeriesListSkeleton />}>
        <SeriesListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SeriesPage;
