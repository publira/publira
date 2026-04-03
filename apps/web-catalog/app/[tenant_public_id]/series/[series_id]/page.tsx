import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { Suspense } from "react";

import { getSeriesDetail, SeriesNotFoundError } from "#lib/catalog";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id", "series_id");

const SeriesDetailSkeleton = () => (
  <div>
    <div className="mb-4 h-9 w-3/4 animate-pulse rounded bg-muted" />
    <div className="mb-8 h-5 w-32 animate-pulse rounded bg-muted" />
    <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
    <div className="mb-2 h-4 w-full animate-pulse rounded bg-muted" />
    <div className="mb-2 h-4 w-1/2 animate-pulse rounded bg-muted" />
    <div className="mt-8 grid gap-3">
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="h-14 animate-pulse rounded bg-muted/70" />
      ))}
    </div>
  </div>
);

const SeriesDetailData = async (
  props: PageProps<"/[tenant_public_id]/series/[series_id]">
) => {
  const { series_id, tenant_public_id } = await props.params;
  guardPlaceholders({ series_id, tenant_public_id });

  let result;
  try {
    result = await getSeriesDetail(tenant_public_id, series_id);
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
      <div className="mb-8">
        <h1 className="mb-2 font-serif text-4xl font-bold">{series.title}</h1>
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
        <p className="mb-10 max-w-2xl whitespace-pre-wrap text-muted-foreground">
          {series.synopsis}
        </p>
      )}

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

export default function Page(
  props: PageProps<"/[tenant_public_id]/series/[series_id]">
) {
  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
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
}
