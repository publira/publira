import { CollectionIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { getSeriesDetail, SeriesNotFoundError } from "#lib/catalog";
import { getTenantId } from "#lib/tenant-id";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const SeriesDetailSkeleton = () => (
  <div>
    <div className="mb-10 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
      <div className="aspect-3/4 animate-pulse rounded-2xl bg-muted" />
      <div>
        <div className="mb-4 h-9 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mb-8 h-5 w-32 animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
        <div className="mb-2 h-4 w-1/2 animate-pulse rounded bg-muted" />
      </div>
    </div>
    <div className="mt-8 grid gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded bg-muted/70" />
      ))}
    </div>
  </div>
);

const SeriesDetailData = async (
  props: PageProps<"/[tenant_id]/series/[series_id]">
) => {
  const { series_id } = await props.params;
  const tenantId = await getTenantId();
  guardPlaceholders({ series_id });

  let result: Awaited<ReturnType<typeof getSeriesDetail>>;
  try {
    result = await getSeriesDetail(tenantId, series_id);
  } catch (error) {
    const message =
      error instanceof SeriesNotFoundError
        ? "シリーズが見つかりませんでした。"
        : "シリーズ詳細の取得に失敗しました。時間をおいて再試行してください。";

    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <p className="mb-4 text-destructive">{message}</p>
        <Link
          href="/series"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          シリーズ一覧に戻る
        </Link>
      </div>
    );
  }

  const { series, episodes } = result;

  return (
    <>
      <div className="mb-10 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
        {series.eyeCatchImageVariants &&
        series.eyeCatchImageVariants.length > 0 ? (
          <div className="overflow-hidden rounded-2xl bg-muted shadow-sm">
            <div className="aspect-3/4 overflow-hidden bg-muted">
              <EyeCatchPicture
                alt={series.title}
                imgClassName="h-full w-full object-cover"
                preferredType="portrait"
                sizes="(max-width: 1024px) 100vw, 280px"
                variants={series.eyeCatchImageVariants}
              />
            </div>
          </div>
        ) : (
          <div className="flex aspect-3/4 items-center justify-center rounded-2xl bg-linear-to-br from-primary/20 to-primary/10 text-primary/40 shadow-sm">
            <CollectionIcon className="h-16 w-16" />
          </div>
        )}

        <div>
          <div className="mb-8">
            <h1 className="mb-2 font-serif text-4xl font-bold">
              {series.title}
            </h1>
            {series.creatorNames.length > 0 && (
              <p className="mb-2 text-muted-foreground">
                {series.creatorNames.join("、")}
              </p>
            )}
            {series.labelName && (
              <span className="inline-block rounded-full bg-muted px-3 py-0.5 text-xs text-muted-foreground">
                {series.labelName}
              </span>
            )}
          </div>

          {series.synopsis && (
            <p className="max-w-2xl whitespace-pre-wrap text-muted-foreground">
              {series.synopsis}
            </p>
          )}
        </div>
      </div>

      <section>
        <h2 className="mb-4 font-serif text-2xl font-semibold">
          エピソード一覧
        </h2>
        {episodes.length === 0 ? (
          <p className="py-10 text-center text-muted-foreground">
            エピソードはまだ公開されていません。
          </p>
        ) : (
          <ol className="grid gap-3">
            {episodes.map((ep) => (
              <li key={ep.publicId}>
                <Link
                  href={`/series/${series.publicId}/episodes/${ep.publicId}`}
                  className="group flex items-center gap-4 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:shadow-md"
                >
                  <span className="min-w-8 text-center text-sm font-medium tabular-nums text-muted-foreground">
                    {ep.orderIndex}
                  </span>
                  <span className="flex-1 font-medium group-hover:text-primary">
                    {ep.title}
                  </span>
                  {ep.price > 0 && (
                    <span className="text-sm text-muted-foreground">
                      ¥{ep.price.toLocaleString("ja-JP")}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
};

const Page = (props: PageProps<"/[tenant_id]/series/[series_id]">) => (
  <main className="mx-auto max-w-5xl px-6 py-12">
    <nav className="mb-8">
      <Link
        href="/series"
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        ← シリーズ一覧に戻る
      </Link>
    </nav>

    <Suspense fallback={<SeriesDetailSkeleton />}>
      <SeriesDetailData {...props} />
    </Suspense>
  </main>
);

export default Page;
