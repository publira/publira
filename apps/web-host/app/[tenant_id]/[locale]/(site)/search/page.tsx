import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getLocale, loadHostMessages } from "#lib/locale";

import {
  CreatorResults,
  CreatorResultsSkeleton,
} from "./_components/creator-results";
import {
  LabelResults,
  LabelResultsSkeleton,
} from "./_components/label-results";
import {
  SeriesResults,
  SeriesResultsSkeleton,
} from "./_components/series-results";
import {
  parseSearchPageSearchParams,
  searchPageHref,
} from "./_lib/search-params";

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

/** What stands in for the three groups while the keyword is being read. */
const SearchResultsSkeleton = () => (
  <div className="grid gap-12">
    <div className="grid gap-4">
      <SkeletonLine className="h-6 w-24" />
      <SeriesResultsSkeleton />
    </div>
    <div className="grid gap-4">
      <SkeletonLine className="h-6 w-24" />
      <CreatorResultsSkeleton />
    </div>
  </div>
);

/**
 * The three groups one keyword answers with.
 *
 * `kind` decides how many of them are on screen: the overview shows all three,
 * each behind its own boundary so a creator match arrives whether or not a
 * series matched, and a group's own view shows that group alone with its cursor
 * pagination. The heading of each group sits outside its boundary, so the shape
 * of the answer is on screen before any of the three reads comes back.
 */
const SearchResults = async ({
  searchParams,
}: {
  searchParams: SearchPageProps["searchParams"];
}) => {
  const resolvedSearchParams = await searchParams;
  const { kind, query, token } =
    parseSearchPageSearchParams(resolvedSearchParams);

  if (!query) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="host.search.prompt" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  const view = kind === "all" ? "overview" : "page";

  return (
    <div className="grid gap-12">
      {(kind === "all" || kind === "series") && (
        <section aria-labelledby="search-series" className="grid gap-4">
          <h2 className="font-serif text-xl leading-tight" id="search-series">
            <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
              <Message message="host.search.series_heading" />
            </Suspense>
          </h2>
          <Suspense fallback={<SeriesResultsSkeleton />}>
            <SeriesResults query={query} token={token} view={view} />
          </Suspense>
        </section>
      )}

      {(kind === "all" || kind === "creators") && (
        <section aria-labelledby="search-creators" className="grid gap-4">
          <h2 className="font-serif text-xl leading-tight" id="search-creators">
            <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
              <Message message="host.search.creators_heading" />
            </Suspense>
          </h2>
          <Suspense fallback={<CreatorResultsSkeleton />}>
            <CreatorResults query={query} token={token} view={view} />
          </Suspense>
        </section>
      )}

      {(kind === "all" || kind === "labels") && (
        <section aria-labelledby="search-labels" className="grid gap-4">
          <h2 className="font-serif text-xl leading-tight" id="search-labels">
            <Suspense fallback={<SkeletonLine className="h-6 w-24" />}>
              <Message message="host.search.labels_heading" />
            </Suspense>
          </h2>
          <Suspense fallback={<LabelResultsSkeleton />}>
            <LabelResults query={query} token={token} view={view} />
          </Suspense>
        </section>
      )}

      {kind !== "all" && (
        <p>
          <LocaleLink
            className="text-sm text-primary underline underline-offset-4"
            href={searchPageHref(query)}
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="host.search.back_to_all" />
            </Suspense>
          </LocaleLink>
        </p>
      )}
    </div>
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
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-32" />}>
          <Message message="host.search.title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <Message message="host.search.description" />
        </Suspense>
      </p>
    </div>

    <Suspense fallback={<CatalogSearchFormSkeleton />}>
      <SearchFormFromParams searchParams={searchParams} />
    </Suspense>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.search.error" />
        </Suspense>
      }
    >
      <Suspense fallback={<SearchResultsSkeleton />}>
        <SearchResults searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SearchPage;
