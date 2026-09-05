import { getMessage } from "@publira/i18n";
import { CollectionIcon } from "@publira/icons";
import { SectionError } from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import { EyeCatchPicture } from "#components/eye-catch-picture";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { searchPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import {
  parseSearchPageSearchParams,
  searchPageHref,
} from "./_lib/search-params";

const SEARCH_PAGE_SIZE = 20;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

type SearchPageProps = PageProps<"/[tenant_id]/[locale]/search">;

export const generateMetadata = async ({
  searchParams,
}: SearchPageProps): Promise<Metadata> => {
  const [resolvedSearchParams, locale] = await Promise.all([
    searchParams,
    getLocale(),
  ]);
  const { query } = parseSearchPageSearchParams(resolvedSearchParams);
  const messages = await loadHostMessages(locale);

  if (!query) {
    return { title: getMessage(messages, "host.search.title") };
  }

  return {
    title: getMessage(messages, "host.search.results_title", { query }),
  };
};

const SearchListSkeleton = () => (
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div
        className="overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm"
        key={i}
      >
        <div className="mb-4 h-32 animate-pulse rounded bg-muted" />
        <div className="mb-1 h-5 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    ))}
  </div>
);

const SearchPagination = async ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.search.pagination_aria")}
      className="mt-8 flex items-center justify-center gap-6"
    >
      {previousToken ? (
        <LocaleLink
          href={searchPageHref(query, previousToken)}
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
          href={searchPageHref(query, nextToken)}
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

const SearchResultsData = async ({
  searchParams,
}: {
  searchParams: SearchPageProps["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { query, token } = parseSearchPageSearchParams(resolvedSearchParams);
  const messages = await loadHostMessages(locale);

  if (!query) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        {getMessage(messages, "host.search.prompt")}
      </p>
    );
  }

  const result = await searchPublishedSeries(tenantId, {
    limit: SEARCH_PAGE_SIZE,
    locale,
    query,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={getMessage(messages, "host.search.error")}
      />
    );
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!token) {
      return (
        <div className="py-20 text-center text-muted-foreground">
          {getMessage(messages, "host.search.no_results", { query })}
        </div>
      );
    }

    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          {getMessage(messages, "host.series.page_empty")}
        </p>
        {previousToken || nextToken ? (
          <SearchPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <LocaleLink
            href={searchPageHref(query, "")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            {getMessage(messages, "host.search.first_page")}
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

      <SearchPagination
        nextToken={nextToken}
        previousToken={previousToken}
        query={query}
      />
    </>
  );
};

const SearchFormFromParams = async ({
  searchParams,
}: {
  searchParams: SearchPageProps["searchParams"];
}) => {
  const resolved = await searchParams;
  const { query } = parseSearchPageSearchParams(resolved);
  return <CatalogSearchForm defaultQuery={query} id="catalog-search-page" />;
};

const SearchPage = ({ searchParams }: SearchPageProps) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">
      <Suspense fallback={<SkeletonLine className="h-9 w-32" />}>
        <Message message="host.search.title" />
      </Suspense>
    </h1>
    <p className="mb-6 text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
        <Message message="host.search.description" />
      </Suspense>
    </p>

    <div className="mb-8 max-w-xl">
      <Suspense fallback={<CatalogSearchFormSkeleton />}>
        <SearchFormFromParams searchParams={searchParams} />
      </Suspense>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.search.error" />
        </Suspense>
      }
    >
      <Suspense fallback={<SearchListSkeleton />}>
        <SearchResultsData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SearchPage;
