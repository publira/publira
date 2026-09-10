import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  SeriesFilterForm,
  SeriesFilterFormSkeleton,
} from "#components/series-filter-form";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { listPublishedGenres, listPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  isNarrowedSeriesList,
  parseSeriesListSearchParams,
  seriesListHref,
} from "./_lib/search-params";
import type { SeriesListSearchParams } from "./_lib/search-params";

const SERIES_PAGE_SIZE = 24;

/** Half a page of covers: two shelves on a desktop, four rows on a phone. */
const SERIES_SKELETON_COUNT = 12;

type SeriesPageSearchParams =
  PageProps<"/[tenant_id]/[locale]/series">["searchParams"];

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.series.list_title") };
};

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
 * The genre options this screen's filter row offers. A tenant that curates no
 * genre, and a read that could not answer, both leave the row its other three
 * controls rather than holding the whole catalog behind one dropdown.
 */
const SeriesListFilters = async ({
  searchParams,
}: {
  searchParams: SeriesPageSearchParams;
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const query = parseSeriesListSearchParams(resolvedSearchParams);
  const genres = await listPublishedGenres(tenantId, locale);

  return (
    <SeriesFilterForm
      basePath="/series"
      genres={genres.ok ? genres.value : []}
      query={query}
    />
  );
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const SeriesPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.series.pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this screen shows them. */
const SeriesPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: SeriesListSearchParams;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <SeriesPaginationNav>
      <ListPaginationStep
        href={
          previousToken
            ? seriesListHref({ ...query, token: previousToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? seriesListHref({ ...query, token: nextToken }) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </SeriesPaginationNav>
  </Suspense>
);

const SeriesListData = async ({
  searchParams,
}: {
  searchParams: SeriesPageSearchParams;
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const query = parseSeriesListSearchParams(resolvedSearchParams);

  const result = await listPublishedSeries(tenantId, {
    genrePublicId: query.genre,
    hasFreeEpisodes: query.free,
    limit: SERIES_PAGE_SIZE,
    locale,
    order: query.order,
    status: query.status || undefined,
    token: query.token,
  });

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
    if (!query.token) {
      // A narrowed list that came back empty is the filters answering, not the
      // catalog being empty, and the way out of it is dropping them.
      return isNarrowedSeriesList(query) ? (
        <div className="grid gap-8">
          <EmptyState>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                <Message message="host.series.filter_empty" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyState>
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href="/series"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.series.filter_clear" />
              </Suspense>
            </LocaleLink>
          </p>
        </div>
      ) : (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.list_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <SeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={seriesListHref({ ...query, token: "" })}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.series.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <SeriesShelf locale={locale} series={series} />

      <SeriesPagination
        nextToken={nextToken}
        previousToken={previousToken}
        query={query}
      />
    </div>
  );
};

const SeriesPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/series">) => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="host.series.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <SeriesListDescription />
        </Suspense>
      </p>
    </div>

    <Suspense fallback={<SeriesFilterFormSkeleton />}>
      <SeriesListFilters searchParams={searchParams} />
    </Suspense>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.series.list_error" />
        </Suspense>
      }
    >
      <Suspense
        fallback={<SeriesShelfSkeleton count={SERIES_SKELETON_COUNT} />}
      >
        <SeriesListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SeriesPage;
