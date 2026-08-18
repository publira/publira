import { CollectionIcon, ImageIcon } from "@publira/icons";
import { SectionError } from "@publira/ui-components/section-error";
import { formatDate } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import {
  getCatalogTopFeaturedAuthors,
  getCatalogTopFeaturedLabels,
  getCatalogTopNewEpisodes,
  getCatalogTopRecommendedSeries,
  getCatalogTopUpdatedSeries,
} from "#lib/catalog-top";
import type {
  CatalogTopEpisodeItem,
  CatalogTopUpdatedSeriesItem,
} from "#lib/catalog-top";
import { getTenantDisplayTimeZone, getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

type EpisodeLinkSource = CatalogTopEpisodeItem & {
  episodePublicId?: string;
  seriesPublicId?: string;
};

type UpdatedSeriesLinkSource = CatalogTopUpdatedSeriesItem & {
  latestEpisodePublicId?: string;
  seriesPublicId?: string;
};

const resolveEpisodeLinkIds = (
  episode: EpisodeLinkSource
): { episodeId: string; seriesId: string } | null => {
  const episodeId =
    ("episodeId" in episode ? episode.episodeId : undefined) ??
    ("episodePublicId" in episode ? episode.episodePublicId : undefined) ??
    "";
  const seriesId =
    ("seriesId" in episode ? episode.seriesId : undefined) ??
    ("seriesPublicId" in episode ? episode.seriesPublicId : undefined) ??
    "";

  if (!episodeId || !seriesId) {
    return null;
  }

  return { episodeId, seriesId };
};

const resolveUpdatedSeriesLinkIds = (
  item: UpdatedSeriesLinkSource
): { latestEpisodeId: string; seriesId: string } | null => {
  const latestEpisodeId =
    ("latestEpisodeId" in item ? item.latestEpisodeId : undefined) ??
    ("latestEpisodePublicId" in item
      ? item.latestEpisodePublicId
      : undefined) ??
    "";
  const seriesId =
    ("seriesId" in item ? item.seriesId : undefined) ??
    ("seriesPublicId" in item ? item.seriesPublicId : undefined) ??
    "";

  if (!latestEpisodeId || !seriesId) {
    return null;
  }

  return { latestEpisodeId, seriesId };
};

/**
 * One title per section, shared by the section's own failure display and by the
 * `SectionErrorBoundary` around it: the reader sees the same sentence whether
 * the read reported a failure or something threw unexpectedly.
 */
const SECTION_TITLES = {
  authors: "注目の著者を表示できませんでした",
  labels: "注目のレーベルを表示できませんでした",
  newEpisodes: "新着エピソードを表示できませんでした",
  recommended: "おすすめ作品を表示できませんでした",
  updated: "更新作品を表示できませんでした",
} as const;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();
  const siteLabel = await getTenantSiteLabel(tenantId);

  // This page shares a route segment with `(site)/layout.tsx`, so Next.js does
  // not apply that layout's `title.template`. Compose the full tab title here.
  return {
    title: {
      absolute: `トップ | ${siteLabel}`,
    },
  };
};

/**
 * The one suspended piece on this page with no `SectionErrorBoundary` around
 * it, on purpose: `getTenantSiteLabel` degrades to 「サイト」 rather than
 * failing, the same way the header brand and the `<title>` do, because it is
 * resolved before any shell exists (#672). There is nothing here for a boundary
 * to catch.
 */
const CatalogTopSiteLabel = async () => {
  const tenantId = await getTenantId();
  const siteLabel = await getTenantSiteLabel(tenantId);

  return (
    <p className="text-sm tracking-[0.14em] text-muted-foreground uppercase">
      {siteLabel}
    </p>
  );
};

const CardGridSkeleton = ({ count = 3 }: { count?: number }) => (
  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: count }, (_, index) => (
      <div
        className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
        key={index}
      >
        <div className="aspect-video animate-pulse bg-muted" />
        <div className="space-y-2 p-5">
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted" />
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

const ListSkeleton = ({ count = 4 }: { count?: number }) => (
  <div className="grid gap-3">
    {Array.from({ length: count }, (_, index) => (
      <div
        className="h-16 animate-pulse rounded-lg border border-border/70 bg-muted/40"
        key={index}
      />
    ))}
  </div>
);

const RecommendedSeriesSection = async () => {
  const tenantId = await getTenantId();

  const result = await getCatalogTopRecommendedSeries(tenantId);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={SECTION_TITLES.recommended}
      />
    );
  }

  const recommendedSeries = result.value;

  if (recommendedSeries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        公開中のシリーズはまだありません。
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {recommendedSeries.map((series) => (
        <Link
          key={series.publicId}
          className="group overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:border-secondary/40 hover:shadow-md"
          href={`/series/${series.publicId}`}
        >
          {series.eyeCatchImageVariants &&
          series.eyeCatchImageVariants.length > 0 ? (
            <div className="aspect-video overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={series.title}
                imgClassName="size-full object-cover"
                preferredType="landscape"
                variants={series.eyeCatchImageVariants}
              />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
              <CollectionIcon className="h-10 w-10" />
            </div>
          )}
          <div className="p-5">
            <h3 className="mb-2 line-clamp-2 font-serif text-lg font-semibold transition-colors group-hover:text-secondary">
              {series.title}
            </h3>
            {series.creatorNames.length > 0 && (
              <p className="mb-2 text-sm text-muted-foreground">
                {series.creatorNames.join("、")}
              </p>
            )}
            {series.synopsis && (
              <p className="line-clamp-3 text-sm text-muted-foreground">
                {series.synopsis}
              </p>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
};

const NewEpisodesSection = async () => {
  const tenantId = await getTenantId();

  const [result, timeZone] = await Promise.all([
    getCatalogTopNewEpisodes(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={SECTION_TITLES.newEpisodes}
      />
    );
  }

  const newEpisodes = result.value;

  if (newEpisodes.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        新着エピソードはまだありません。
      </p>
    );
  }

  return (
    <ol className="grid gap-3">
      {newEpisodes.map((episode) => {
        const ids = resolveEpisodeLinkIds(episode);
        if (!ids) {
          return null;
        }

        return (
          <li key={`${ids.seriesId}-${ids.episodeId}`}>
            <Link
              className="group flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:border-accent/40 hover:shadow-md"
              href={`/series/${ids.seriesId}/episodes/${ids.episodeId}`}
            >
              <div>
                <p className="text-xs text-muted-foreground">
                  {episode.seriesTitle}
                </p>
                <p className="font-medium transition-colors group-hover:text-secondary">
                  {episode.episodeTitle}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDate(episode.publishedAt, { fallback: "", timeZone })}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
};

const UpdatedSeriesSection = async () => {
  const tenantId = await getTenantId();

  const [result, timeZone] = await Promise.all([
    getCatalogTopUpdatedSeries(tenantId),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={SECTION_TITLES.updated}
      />
    );
  }

  const updatedSeries = result.value;

  if (updatedSeries.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        更新作品はまだありません。
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {updatedSeries.map((item) => {
        const ids = resolveUpdatedSeriesLinkIds(item);
        if (!ids) {
          return null;
        }

        return (
          <article
            key={ids.seriesId}
            className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
          >
            <Link className="block" href={`/series/${ids.seriesId}`}>
              {item.eyeCatchImageVariants &&
              item.eyeCatchImageVariants.length > 0 ? (
                <div className="aspect-video overflow-hidden bg-muted">
                  <EyeCatchPicture
                    alt={item.seriesTitle}
                    imgClassName="size-full object-cover"
                    preferredType="landscape"
                    variants={item.eyeCatchImageVariants}
                  />
                </div>
              ) : (
                <div className="flex aspect-video items-center justify-center bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50">
                  <CollectionIcon className="h-10 w-10" />
                </div>
              )}
            </Link>
            <div className="p-5">
              <h3 className="mb-1 font-serif text-lg font-semibold">
                <Link
                  className="underline-offset-4 transition-colors hover:text-secondary hover:underline"
                  href={`/series/${ids.seriesId}`}
                >
                  {item.seriesTitle}
                </Link>
              </h3>
              {item.creatorNames.length > 0 && (
                <p className="mb-3 text-sm text-muted-foreground">
                  {item.creatorNames.join("、")}
                </p>
              )}
              <p className="mb-2 text-xs text-muted-foreground">最新更新</p>
              <Link
                className="font-medium text-accent underline-offset-4 hover:underline"
                href={`/series/${ids.seriesId}/episodes/${ids.latestEpisodeId}`}
              >
                {item.latestEpisodeTitle}
              </Link>
              <p className="mt-2 text-xs text-muted-foreground">
                公開日{" "}
                {formatDate(item.latestPublishedAt, {
                  fallback: "未設定",
                  timeZone,
                })}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
};

const FeaturedLabelsSection = async () => {
  const tenantId = await getTenantId();

  const result = await getCatalogTopFeaturedLabels(tenantId);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={SECTION_TITLES.labels}
      />
    );
  }

  const featuredLabels = result.value;

  if (featuredLabels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        公開中シリーズに紐づくレーベルはまだありません。
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {featuredLabels.map((label) => (
        <Link
          key={label.publicId}
          href={`/labels/${label.publicId}`}
          className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:border-secondary/40 hover:shadow-md"
        >
          {label.eyeCatchImageVariants &&
          label.eyeCatchImageVariants.length > 0 ? (
            <div className="aspect-video overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={label.name}
                imgClassName="size-full object-cover"
                variants={label.eyeCatchImageVariants}
              />
            </div>
          ) : (
            <div className="flex aspect-video items-center justify-center bg-linear-to-br from-accent/25 via-primary/10 to-secondary/20 text-accent/55">
              <ImageIcon className="h-10 w-10" />
            </div>
          )}

          <div className="p-4">
            <p className="font-medium">{label.name}</p>
          </div>
        </Link>
      ))}
    </div>
  );
};

const FeaturedAuthorsSection = async () => {
  const tenantId = await getTenantId();

  const result = await getCatalogTopFeaturedAuthors(tenantId);

  if (!result.ok) {
    return (
      <SectionError
        description={result.message}
        title={SECTION_TITLES.authors}
      />
    );
  }

  const featuredAuthors = result.value;

  if (featuredAuthors.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        公開中シリーズに紐づく著者はまだいません。
      </p>
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {featuredAuthors.map((author) => (
        <Link
          key={author.id}
          className="group rounded-lg border border-border/70 bg-card p-5 shadow-sm transition hover:border-accent/40 hover:shadow-md"
          href={`/authors/${author.id}`}
        >
          <p className="mb-1 font-medium transition-colors group-hover:text-secondary">
            {author.name}
          </p>
          <p className="text-sm text-muted-foreground">
            公開中シリーズ {author.seriesCount} 件
          </p>
        </Link>
      ))}
    </div>
  );
};

const Page = () => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <header className="mb-10 space-y-4">
      <Suspense
        fallback={
          <div
            aria-hidden
            className="h-4 w-24 animate-pulse rounded bg-muted"
          />
        }
      >
        <CatalogTopSiteLabel />
      </Suspense>
      <h1 className="font-serif text-4xl font-bold">カタログトップ</h1>
      <p className="max-w-3xl text-muted-foreground">
        おすすめ、新着、更新作品から気になる作品を見つけてください。
      </p>
      <div className="flex flex-wrap gap-3">
        <Link
          className="rounded-full bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition hover:opacity-90"
          href="/series"
        >
          シリーズ一覧へ
        </Link>
        <Link
          className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition hover:opacity-90"
          href="/labels"
        >
          レーベル一覧へ
        </Link>
        <Link
          className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium transition hover:border-primary/40 hover:bg-primary/10 hover:text-primary"
          href="/authors"
        >
          著者一覧へ
        </Link>
      </div>
    </header>

    <section aria-labelledby="recommended-works" className="mb-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          id="recommended-works"
          className="font-serif text-2xl font-semibold"
        >
          おすすめ作品
        </h2>
        <Link
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/series"
        >
          すべて見る
        </Link>
      </div>
      <SectionErrorBoundary title={SECTION_TITLES.recommended}>
        <Suspense fallback={<CardGridSkeleton />}>
          <RecommendedSeriesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="new-episodes" className="mb-12">
      <h2 id="new-episodes" className="mb-4 font-serif text-2xl font-semibold">
        新着エピソード
      </h2>
      <SectionErrorBoundary title={SECTION_TITLES.newEpisodes}>
        <Suspense fallback={<ListSkeleton />}>
          <NewEpisodesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="updated-series" className="mb-12">
      <h2
        id="updated-series"
        className="mb-4 font-serif text-2xl font-semibold"
      >
        更新作品
      </h2>
      <SectionErrorBoundary title={SECTION_TITLES.updated}>
        <Suspense fallback={<CardGridSkeleton />}>
          <UpdatedSeriesSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="featured-labels" className="mb-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="featured-labels" className="font-serif text-2xl font-semibold">
          注目のレーベル
        </h2>
        <Link
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/labels"
        >
          レーベル一覧へ
        </Link>
      </div>
      <SectionErrorBoundary title={SECTION_TITLES.labels}>
        <Suspense fallback={<CardGridSkeleton />}>
          <FeaturedLabelsSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>

    <section aria-labelledby="featured-authors">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="featured-authors" className="font-serif text-2xl font-semibold">
          注目の著者
        </h2>
        <Link
          className="text-sm font-medium text-accent underline-offset-4 hover:underline"
          href="/authors"
        >
          著者一覧へ
        </Link>
      </div>
      <SectionErrorBoundary title={SECTION_TITLES.authors}>
        <Suspense fallback={<CardGridSkeleton />}>
          <FeaturedAuthorsSection />
        </Suspense>
      </SectionErrorBoundary>
    </section>
  </main>
);

export default Page;
