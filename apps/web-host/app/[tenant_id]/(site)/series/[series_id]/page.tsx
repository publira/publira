import { CollectionIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { PageLoadError } from "#components/page-load-error";
import { getSeriesDetail } from "#lib/catalog";
import { getTenantId } from "#lib/tenant-id";

/**
 * A missing series must call `notFound()` outside `<Suspense>` so the response
 * status is HTTP 404 instead of a streamed 200 (same pattern as authors detail
 * and the published-page route). Instant shell is not used for this segment.
 */
export const instant = false;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id");

const Page = async (props: PageProps<"/[tenant_id]/series/[series_id]">) => {
  const [{ series_id }, tenantId] = await Promise.all([
    props.params,
    getTenantId(),
  ]);
  guardPlaceholders({ series_id });

  // Missing / unpublished / other-tenant series all resolve to `null`, and the
  // public site must not tell those apart. A failed read is a value as well:
  // this page awaits before anything is flushed, so a throw would answer a bare
  // 500 that no boundary can reach (#672).
  const result = await getSeriesDetail(tenantId, series_id);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { episodes, series } = result.value;

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <nav className="mb-8">
        <Link
          href="/series"
          className="text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          ← シリーズ一覧に戻る
        </Link>
      </nav>

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
          <div className="flex aspect-3/4 items-center justify-center rounded-2xl bg-linear-to-br from-secondary/25 via-primary/15 to-accent/20 text-secondary/50 shadow-sm">
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
              <span className="inline-block rounded-full bg-accent/15 px-3 py-0.5 text-xs font-medium text-accent">
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
                  className="group flex items-center gap-4 rounded-lg border border-border/70 bg-card px-5 py-4 shadow-sm transition hover:border-accent/40 hover:shadow-md"
                >
                  <span className="min-w-8 text-center text-sm font-medium text-muted-foreground tabular-nums">
                    {ep.orderIndex}
                  </span>
                  <span className="flex-1 font-medium transition-colors group-hover:text-secondary">
                    {ep.title}
                  </span>
                  {ep.price > 0 ? (
                    <span className="rounded-full bg-warning/15 px-2.5 py-0.5 text-sm font-medium text-warning">
                      ¥{ep.price.toLocaleString("ja-JP")}
                    </span>
                  ) : (
                    <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-sm font-medium text-success">
                      無料
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </main>
  );
};

export default Page;
