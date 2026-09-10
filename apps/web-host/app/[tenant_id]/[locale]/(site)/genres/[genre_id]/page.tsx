import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { PageLoadError } from "#components/page-load-error";
import {
  SeriesFilterForm,
  SeriesFilterFormSkeleton,
} from "#components/series-filter-form";
import { SeriesShelf, SeriesShelfSkeleton } from "#components/series-shelf";
import { listPublishedGenres, listPublishedSeries } from "#lib/catalog";
import type { PublishedGenreItem } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import {
  genreDetailHref,
  isNarrowedGenreSeries,
  parseGenreDetailParams,
  parseGenreDetailSearchParams,
} from "./_lib/search-params";
import type { GenreDetailSearchParams } from "./_lib/search-params";

const GENRE_SERIES_PAGE_SIZE = 24;

type GenreDetailPageProps =
  PageProps<"/[tenant_id]/[locale]/genres/[genre_id]">;

/**
 * The genre a `public_id` names, or `null` when this tenant curates no such
 * genre. The genre list is the whole classification and is read under the same
 * arguments by `generateMetadata` and by the page body, so both share one
 * `"use cache"` entry and one RPC.
 */
const findGenre = (
  genres: readonly PublishedGenreItem[],
  genreId: string
): PublishedGenreItem | null =>
  genres.find((genre) => genre.publicId === genreId) ?? null;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "genre_id");

export const generateMetadata = async ({
  params,
}: GenreDetailPageProps): Promise<Metadata> => {
  const [{ genre_id }, tenantId, locale] = await Promise.all([
    params,
    getTenantId(),
    getLocale(),
  ]);

  guardPlaceholders({ genre_id });

  const genreId = parseGenreDetailParams({ genre_id });
  const [genres, messages] = await Promise.all([
    genreId
      ? listPublishedGenres(tenantId, locale)
      : { ok: true as const, value: [] },
    loadHostMessages(locale),
  ]);

  // An unavailable genre reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const genre = genreId && genres.ok ? findGenre(genres.value, genreId) : null;

  if (!genre) {
    return { title: getMessage(messages, "host.genres.not_found_title") };
  }

  return { title: genre.name };
};

const GenreDetailSkeleton = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <SkeletonLine className="h-8 w-1/2" />
      <SkeletonLine className="h-4 w-40" />
    </div>
    <SeriesFilterFormSkeleton />
    <SeriesShelfSkeleton />
  </div>
);

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const GenreSeriesPaginationNav = async ({
  children,
}: {
  children: ReactNode;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.genres.series_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

const GenreSeriesPagination = ({
  genreId,
  nextToken,
  previousToken,
  query,
}: {
  genreId: string;
  nextToken: string;
  previousToken: string;
  query: GenreDetailSearchParams;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <GenreSeriesPaginationNav>
      <ListPaginationStep
        href={
          previousToken
            ? genreDetailHref(genreId, { ...query, token: previousToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={
          nextToken
            ? genreDetailHref(genreId, { ...query, token: nextToken })
            : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </GenreSeriesPaginationNav>
  </Suspense>
);

const GenreSeries = async ({
  genreId,
  locale,
  query,
  tenantId,
}: {
  genreId: string;
  locale: Locale;
  query: GenreDetailSearchParams;
  tenantId: string;
}) => {
  const result = await listPublishedSeries(tenantId, {
    genrePublicId: genreId,
    hasFreeEpisodes: query.free,
    limit: GENRE_SERIES_PAGE_SIZE,
    locale,
    order: query.order,
    status: query.status || undefined,
    token: query.token,
  });

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!query.token) {
      return (
        <div className="grid gap-8">
          <EmptyState>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
                {isNarrowedGenreSeries(query) ? (
                  <Message message="host.series.filter_empty" />
                ) : (
                  <Message message="host.genres.series_empty" />
                )}
              </Suspense>
            </EmptyStateDescription>
          </EmptyState>
          {isNarrowedGenreSeries(query) && (
            <p>
              <LocaleLink
                className="text-sm text-primary underline underline-offset-4"
                href={`/genres/${genreId}`}
              >
                <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                  <Message message="host.series.filter_clear" />
                </Suspense>
              </LocaleLink>
            </p>
          )}
        </div>
      );
    }

    // The covers this page pointed at are gone. The server hands back a token
    // for the neighbouring page when it can, and empty tokens when it cannot —
    // then the only way out is the first page (`proto/README.md`).
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
          <GenreSeriesPagination
            genreId={genreId}
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={genreDetailHref(genreId, { ...query, token: "" })}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.genres.series_first_page" />
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
      <GenreSeriesPagination
        genreId={genreId}
        nextToken={nextToken}
        previousToken={previousToken}
        query={query}
      />
    </div>
  );
};

const GenreDetailContent = async ({
  params,
  searchParams,
}: GenreDetailPageProps) => {
  const [{ genre_id }, tenantId, resolvedSearchParams, locale] =
    await Promise.all([params, getTenantId(), searchParams, getLocale()]);

  guardPlaceholders({ genre_id });

  const genreId = parseGenreDetailParams({ genre_id });
  const query = parseGenreDetailSearchParams(resolvedSearchParams);

  if (!genreId) {
    notFound();
  }

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything.
  const genres = await listPublishedGenres(tenantId, locale);

  if (!genres.ok) {
    return <PageLoadError description={genres.message} />;
  }

  const genre = findGenre(genres.value, genreId);

  if (!genre) {
    notFound();
  }

  return (
    <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
      <div className="grid gap-2">
        <h1 className="font-serif text-3xl leading-tight">{genre.name}</h1>
        <p className="text-sm text-muted-foreground tabular-nums">
          <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
            <Message
              message="host.common.series_count"
              values={{ count: genre.publishedSeriesCount }}
            />
          </Suspense>
        </p>
      </div>

      <Suspense fallback={<SeriesFilterFormSkeleton />}>
        <SeriesFilterForm
          basePath={`/genres/${genreId}`}
          genres={[]}
          query={query}
        />
      </Suspense>

      <Suspense fallback={<SeriesShelfSkeleton />}>
        <GenreSeries
          genreId={genreId}
          locale={locale}
          query={query}
          tenantId={tenantId}
        />
      </Suspense>

      <p>
        <LocaleLink
          className="text-sm text-primary underline underline-offset-4"
          href="/genres"
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
            <Message message="host.genres.back_to_list" />
          </Suspense>
        </LocaleLink>
      </p>
    </main>
  );
};

const Page = (props: GenreDetailPageProps) => (
  <Suspense fallback={<GenreDetailSkeleton />}>
    <GenreDetailContent {...props} />
  </Suspense>
);

export default Page;
