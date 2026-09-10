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
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  CatalogSearchForm,
  CatalogSearchFormSkeleton,
} from "#components/catalog-search-form";
import { EyeCatchFrame } from "#components/eye-catch-frame";
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

/** Enough rows to fill a phone screen while the read comes back. */
const SEARCH_SKELETON_COUNT = 8;

/** The one style both pagination directions and the first-page link share. */
const paginationLinkClassName =
  "text-sm text-primary underline underline-offset-4";

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

const SearchRowsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: SEARCH_SKELETON_COUNT }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The pagination's own `<nav>`.
 *
 * `aria-label` cannot be a node, so this resolves the catalog for that one
 * attribute and nothing else. The words inside are the caller's, each behind a
 * boundary of its own, so the navigation is the largest thing one missing
 * string can hold up.
 */
const SearchPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <nav
      aria-label={getMessage(messages, "host.search.pagination_aria")}
      className="flex items-baseline gap-6 border-t border-border pt-4"
    >
      {children}
    </nav>
  );
};

const SearchPaginationSkeleton = () => (
  <div className="flex items-baseline gap-6 border-t border-border pt-4">
    <SkeletonLine className="h-4 w-24" />
    <SkeletonLine className="h-4 w-16" />
  </div>
);

/**
 * A cursor list has no page numbers to set in ink, so the two directions are
 * all there is to render: the one that leads somewhere is an Ai text link, and
 * the end of the list is the same words without one.
 */
const SearchPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => (
  <Suspense fallback={<SearchPaginationSkeleton />}>
    <SearchPaginationNav>
      {previousToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={searchPageHref(query, previousToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
            <Message message="host.common.previous_page" />
          </Suspense>
        </span>
      )}

      {nextToken ? (
        <LocaleLink
          className={paginationLinkClassName}
          href={searchPageHref(query, nextToken)}
        >
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </LocaleLink>
      ) : (
        <span className="text-sm text-muted-foreground">
          <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
            <Message message="host.common.next_page" />
          </Suspense>
        </span>
      )}
    </SearchPaginationNav>
  </Suspense>
);

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

  const result = await searchPublishedSeries(tenantId, {
    limit: SEARCH_PAGE_SIZE,
    locale,
    query,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.search.error" />
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
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.search.no_results" values={{ query }} />
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
          <SearchPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className={paginationLinkClassName}
              href={searchPageHref(query, "")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.search.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ul className="divide-y divide-border border-t border-border">
        {series.map((item) => (
          <li key={item.publicId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${item.publicId}`}
            >
              <EyeCatchFrame
                // The title is beside it in the row, so repeating it here
                // would read every result out twice.
                alt=""
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={item.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif leading-tight underline-offset-4 group-hover:underline">
                  {item.title}
                </span>
                {item.creatorNames.length > 0 && (
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {formatList(item.creatorNames, { locale })}
                  </span>
                )}
              </span>
            </LocaleLink>
          </li>
        ))}
      </ul>

      <SearchPagination
        nextToken={nextToken}
        previousToken={previousToken}
        query={query}
      />
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
      <Suspense fallback={<SearchRowsSkeleton />}>
        <SearchResultsData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SearchPage;
