import { CollectionIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { getCatalogTopData } from "#lib/catalog-top";
import type {
  CatalogTopEpisodeItem,
  CatalogTopUpdatedSeriesItem,
} from "#lib/catalog-top";
import { getTenantSiteLabel } from "#lib/tenant";
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

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_id: string }>;
}): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const siteLabel = await getTenantSiteLabel(tenantId);

  return {
    title: `トップ | ${siteLabel}`,
  };
};

export default async function Page({
  params,
}: PageProps<"/[tenant_id]">) {
  const tenantId = await getTenantId();

  const siteLabel = await getTenantSiteLabel(tenantId);

  let topData: Awaited<ReturnType<typeof getCatalogTopData>>;
  try {
    topData = await getCatalogTopData(tenantId);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      throw error;
    }

    console.error("Failed to load catalog top", error);

    return (
      <main className="mx-auto max-w-6xl px-6 py-12">
        <header className="mb-8 space-y-3">
          <p className="text-sm tracking-[0.14em] uppercase text-muted-foreground">
            {siteLabel}
          </p>
          <h1 className="font-serif text-4xl font-bold">カタログトップ</h1>
        </header>

        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
          <p className="mb-4 text-destructive">
            カタログトップの読み込みに失敗しました。時間をおいて再試行してください。
          </p>
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href="."
          >
            再試行
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <header className="mb-10 space-y-4">
        <p className="text-sm tracking-[0.14em] uppercase text-muted-foreground">
          {siteLabel}
        </p>
        <h1 className="font-serif text-4xl font-bold">カタログトップ</h1>
        <p className="max-w-3xl text-muted-foreground">
          おすすめ、新着、更新作品から気になる作品を見つけてください。
        </p>
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-muted"
            href="/series"
          >
            シリーズ一覧へ
          </Link>
          <Link
            className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-muted"
            href="/labels"
          >
            レーベル一覧へ
          </Link>
          <Link
            className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium hover:bg-muted"
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
            className="text-sm text-primary underline-offset-4 hover:underline"
            href="/series"
          >
            すべて見る
          </Link>
        </div>

        {topData.recommendedSeries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            公開中のシリーズはまだありません。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topData.recommendedSeries.map((series) => (
              <Link
                key={series.publicId}
                className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm transition hover:shadow-md"
                href={`/series/${series.publicId}`}
              >
                {series.eyeCatchImageVariants &&
                series.eyeCatchImageVariants.length > 0 ? (
                  <div className="aspect-video overflow-hidden bg-muted">
                    <EyeCatchPicture
                      alt={series.title}
                      imgClassName="h-full w-full object-cover"
                      preferredType="landscape"
                      variants={series.eyeCatchImageVariants}
                    />
                  </div>
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
                    <CollectionIcon className="h-10 w-10" />
                  </div>
                )}
                <div className="p-5">
                  <h3 className="mb-2 line-clamp-2 font-serif text-lg font-semibold">
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
        )}
      </section>

      <section aria-labelledby="new-episodes" className="mb-12">
        <h2
          id="new-episodes"
          className="mb-4 font-serif text-2xl font-semibold"
        >
          新着エピソード
        </h2>

        {topData.newEpisodes.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            新着エピソードはまだありません。
          </p>
        ) : (
          <ol className="grid gap-3">
            {topData.newEpisodes.map((episode) => {
              const ids = resolveEpisodeLinkIds(episode);
              if (!ids) {
                return null;
              }

              return (
                <li key={`${ids.seriesId}-${ids.episodeId}`}>
                  <Link
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:shadow-md"
                    href={`/series/${ids.seriesId}/episodes/${ids.episodeId}`}
                  >
                    <div>
                      <p className="text-xs text-muted-foreground">
                        {episode.seriesTitle}
                      </p>
                      <p className="font-medium">{episode.episodeTitle}</p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {episode.publishedAt.slice(0, 10)}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="updated-series" className="mb-12">
        <h2
          id="updated-series"
          className="mb-4 font-serif text-2xl font-semibold"
        >
          更新作品
        </h2>

        {topData.updatedSeries.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            更新作品はまだありません。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topData.updatedSeries.map((item) => {
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
                          imgClassName="h-full w-full object-cover"
                          preferredType="landscape"
                          variants={item.eyeCatchImageVariants}
                        />
                      </div>
                    ) : (
                      <div className="flex aspect-video items-center justify-center bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
                        <CollectionIcon className="h-10 w-10" />
                      </div>
                    )}
                  </Link>
                  <div className="p-5">
                    <h3 className="mb-1 font-serif text-lg font-semibold">
                      <Link
                        className="underline-offset-4 hover:underline"
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
                    <p className="mb-2 text-xs text-muted-foreground">
                      最新更新
                    </p>
                    <Link
                      className="font-medium text-primary underline-offset-4 hover:underline"
                      href={`/series/${ids.seriesId}/episodes/${ids.latestEpisodeId}`}
                    >
                      {item.latestEpisodeTitle}
                    </Link>
                    <p className="mt-2 text-xs text-muted-foreground">
                      公開日 {item.latestPublishedAt.slice(0, 10)}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section aria-labelledby="featured-labels" className="mb-12">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2
            id="featured-labels"
            className="font-serif text-2xl font-semibold"
          >
            注目のレーベル
          </h2>
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href="/labels"
          >
            レーベル一覧へ
          </Link>
        </div>

        {topData.featuredLabels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            公開中シリーズに紐づくレーベルはまだありません。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topData.featuredLabels.map((label) => (
              <article
                key={label.publicId}
                className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
              >
                {label.eyeCatchImageVariants &&
                label.eyeCatchImageVariants.length > 0 ? (
                  <div className="aspect-video overflow-hidden bg-muted">
                    <EyeCatchPicture
                      alt={label.name}
                      imgClassName="h-full w-full object-cover"
                      variants={label.eyeCatchImageVariants}
                    />
                  </div>
                ) : (
                  <div className="flex aspect-video items-center justify-center bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
                    <svg
                      className="h-10 w-10"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                      />
                    </svg>
                  </div>
                )}

                <div className="p-4">
                  <p className="font-medium">{label.name}</p>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="featured-authors">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2
            id="featured-authors"
            className="font-serif text-2xl font-semibold"
          >
            注目の著者
          </h2>
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href="/authors"
          >
            著者一覧へ
          </Link>
        </div>

        {topData.featuredAuthors.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
            公開中シリーズに紐づく著者はまだいません。
          </p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {topData.featuredAuthors.map((author) => (
              <Link
                key={author.id}
                className="rounded-lg border border-border/70 bg-card p-5 shadow-sm transition hover:shadow-md"
                href={`/authors/${author.id}`}
              >
                <p className="mb-1 font-medium">{author.name}</p>
                <p className="text-sm text-muted-foreground">
                  公開中シリーズ {author.seriesCount} 件
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
