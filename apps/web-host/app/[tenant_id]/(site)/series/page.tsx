import { CollectionIcon } from "@publira/icons";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { listPublishedSeries } from "#lib/catalog";
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
  const tenantId = await getTenantId();

  const siteLabel = await getTenantSiteLabel(tenantId);

  return {
    title: `シリーズ一覧 | ${siteLabel}`,
  };
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

const TenantSiteLabel = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteLabel(tenantId);
};

const SeriesPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="シリーズ一覧ページング"
    className="mt-8 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        href={seriesListHref(previousToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        href={seriesListHref(nextToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const SeriesListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/series">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { token } = parseSeriesListSearchParams(resolvedSearchParams);

  let page;
  try {
    page = await listPublishedSeries(tenantId, {
      limit: SERIES_PAGE_SIZE,
      token,
    });
  } catch {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <p className="mb-4 text-destructive">
          シリーズ一覧の取得に失敗しました。時間をおいて再試行してください。
        </p>
        <Link
          href={seriesListHref(token)}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          再試行
        </Link>
      </div>
    );
  }

  const { nextToken, previousToken, series } = page;

  if (series.length === 0) {
    if (!token) {
      return (
        <div className="py-20 text-center text-muted-foreground">
          シリーズはまだ登録されていません。
        </div>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          このページに表示できるシリーズがありません。
        </p>
        {previousToken || nextToken ? (
          <SeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <Link
            href={seriesListHref("")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            シリーズ一覧の先頭へ
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

      <SeriesPagination nextToken={nextToken} previousToken={previousToken} />
    </>
  );
};

const SeriesPage = ({ searchParams }: PageProps<"/[tenant_id]/series">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">シリーズ一覧</h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense
        fallback={
          <span
            aria-hidden
            className="inline-block h-4 w-16 align-middle animate-pulse rounded bg-muted"
          />
        }
      >
        <TenantSiteLabel />
      </Suspense>
      に登録されているシリーズをご紹介します
    </p>

    <Suspense fallback={<SeriesListSkeleton />}>
      <SeriesListData searchParams={searchParams} />
    </Suspense>
  </main>
);

export default SeriesPage;
