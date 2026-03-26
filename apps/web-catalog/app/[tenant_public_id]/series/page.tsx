import { CollectionIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { Suspense } from "react";

import { listPublishedSeries } from "../../../lib/catalog";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

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

const SeriesListData = async (
  props: PageProps<"/[tenant_public_id]/series">
) => {
  const { tenant_public_id } = await props.params;
  guardPlaceholder(tenant_public_id);

  let series;
  try {
    series = await listPublishedSeries(tenant_public_id);
  } catch {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-center">
        <p className="mb-4 text-destructive">
          シリーズ一覧の取得に失敗しました。時間をおいて再試行してください。
        </p>
        <Link
          href="/series"
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          再試行
        </Link>
      </div>
    );
  }

  if (series.length === 0) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        シリーズはまだ登録されていません。
      </div>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {series.map((item) => (
        <Link
          key={item.publicId}
          href={`/series/${item.publicId}`}
          className="group overflow-hidden rounded-lg border border-border/70 bg-card p-6 shadow-sm transition hover:shadow-md"
        >
          <div className="mb-4 flex h-32 items-center justify-center rounded bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
            <CollectionIcon className="h-12 w-12" />
          </div>
          <h2 className="mb-1 font-serif text-lg font-semibold group-hover:text-primary">
            {item.title}
          </h2>
          {item.creatorNames.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {item.creatorNames.join("、")}
            </p>
          )}
          {item.labelName && (
            <p className="mt-1 text-xs text-muted-foreground">
              {item.labelName}
            </p>
          )}
          {item.synopsis && (
            <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
              {item.synopsis}
            </p>
          )}
        </Link>
      ))}
    </div>
  );
};

export default function SeriesPage(
  props: PageProps<"/[tenant_public_id]/series">
) {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-2 font-serif text-4xl font-bold">シリーズ一覧</h1>
      <p className="mb-8 text-muted-foreground">
        Publira に登録されているシリーズをご紹介します
      </p>

      <Suspense fallback={<SeriesListSkeleton />}>
        <SeriesListData {...props} />
      </Suspense>
    </main>
  );
}
