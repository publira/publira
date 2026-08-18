import { CollectionIcon } from "@publira/icons";
import { SectionError } from "@publira/ui-components/section-error";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { CatalogSearchForm } from "#components/catalog-search-form";
import { EyeCatchPicture } from "#components/eye-catch-picture";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { searchPublishedSeries } from "#lib/catalog";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  parseSearchPageSearchParams,
  searchPageHref,
} from "./_lib/search-params";

const SEARCH_PAGE_SIZE = 20;
const SECTION_TITLE = "検索結果を表示できませんでした";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

type SearchPageProps = PageProps<"/[tenant_id]/search">;

export const generateMetadata = async ({
  searchParams,
}: SearchPageProps): Promise<Metadata> => {
  const [tenantId, resolvedSearchParams] = await Promise.all([
    getTenantId(),
    searchParams,
  ]);
  const { query } = parseSearchPageSearchParams(resolvedSearchParams);
  const siteLabel = await getTenantSiteLabel(tenantId);

  if (!query) {
    return {
      title: `検索 | ${siteLabel}`,
    };
  }

  return {
    title: `「${query}」の検索結果 | ${siteLabel}`,
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

const SearchPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => (
  <nav
    aria-label="検索結果ページング"
    className="mt-8 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        href={searchPageHref(query, previousToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        href={searchPageHref(query, nextToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const SearchResultsData = async ({
  searchParams,
}: {
  searchParams: SearchPageProps["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { query, token } = parseSearchPageSearchParams(resolvedSearchParams);

  if (!query) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        キーワードを入力して公開中のシリーズを検索できます。
      </p>
    );
  }

  const result = await searchPublishedSeries(tenantId, {
    limit: SEARCH_PAGE_SIZE,
    query,
    token,
  });

  if (!result.ok) {
    return <SectionError description={result.message} title={SECTION_TITLE} />;
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!token) {
      return (
        <div className="py-20 text-center text-muted-foreground">
          「{query}」に一致するシリーズはありません。
        </div>
      );
    }

    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          このページに表示できるシリーズがありません。
        </p>
        {previousToken || nextToken ? (
          <SearchPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <Link
            href={searchPageHref(query, "")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            検索結果の先頭へ
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {series.map((item) => (
          <Link
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
                  {item.creatorNames.join("、")}
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
          </Link>
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
    <h1 className="mb-2 font-serif text-4xl font-bold">検索</h1>
    <p className="mb-6 text-muted-foreground">
      公開中シリーズのタイトルとあらすじから探せます
    </p>

    <div className="mb-8 max-w-xl">
      <Suspense
        fallback={
          <div className="h-9 w-full max-w-64 animate-pulse rounded-md bg-muted" />
        }
      >
        <SearchFormFromParams searchParams={searchParams} />
      </Suspense>
    </div>

    <SectionErrorBoundary title={SECTION_TITLE}>
      <Suspense fallback={<SearchListSkeleton />}>
        <SearchResultsData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SearchPage;
