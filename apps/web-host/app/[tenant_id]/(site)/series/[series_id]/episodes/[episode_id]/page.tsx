import { DEFAULT_TIME_ZONE, formatDateTime } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import {
  parseRouteParams,
  routeParamString,
} from "@publira/utils/route-params";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageLoadError } from "#components/page-load-error";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { getEpisodeDetail, isPublicEpisodeBody } from "#lib/catalog";
import { getTenantSiteInfo } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { EpisodeBody } from "./_components/episode-body";
import { parsePurchaseSearchParams } from "./_lib/purchase-search-params";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "series_id", "episode_id");

const episodeDetailParamsSchema = z.object({
  episode_id: routeParamString(),
  series_id: routeParamString(),
});

const EpisodeSkeleton = () => (
  <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
      <div className="order-2 space-y-6 lg:order-1">
        <div className="h-40 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        <div className="h-96 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
      </div>
      <div className="order-1 space-y-4 lg:order-2">
        <div className="h-32 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
        <div className="h-48 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
      </div>
    </div>
  </div>
);

const EpisodeBodySkeleton = () => (
  <div className="h-96 animate-pulse rounded-3xl border border-border/70 bg-muted/40" />
);

const EpisodeContent = async (
  props: PageProps<"/[tenant_id]/series/[series_id]/episodes/[episode_id]">
) => {
  const [rawParams, tenantId, searchParams] = await Promise.all([
    props.params,
    getTenantId(),
    props.searchParams,
  ]);
  const parsedParams = parseRouteParams(episodeDetailParamsSchema, rawParams);
  if (!parsedParams) {
    notFound();
  }
  const { episode_id, series_id } = parsedParams;
  const purchaseSearchParams = parsePurchaseSearchParams(searchParams);

  // Missing / unpublished / other-series / other-tenant episodes resolve to
  // `null`, and the public site must not tell those apart. A failed read is a
  // value as well: a `"use cache"` fill that throws fails the whole request,
  // so nothing downstream would get to render (#672).
  const [result, tenant] = await Promise.all([
    getEpisodeDetail(tenantId, series_id, episode_id),
    getTenantSiteInfo(tenantId),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  if (!result.value) {
    notFound();
  }

  const { access, episode, images, series } = result.value;
  // The site-info read resolves the tenant zone. The fallback only covers an
  // unavailable tenant read, never the host machine's local zone.
  const timeZone = tenant?.timeZone ?? DEFAULT_TIME_ZONE;
  const priceLabel =
    episode.price > 0 ? `¥${episode.price.toLocaleString("ja-JP")}` : "無料";

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <nav className="mb-8 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <Link className="underline-offset-4 hover:underline" href="/series">
          シリーズ一覧
        </Link>
        <span>／</span>
        <Link
          className="underline-offset-4 hover:underline"
          href={`/series/${series.publicId}`}
        >
          シリーズ詳細
        </Link>
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        <article className="order-2 space-y-6 lg:order-1">
          <header className="rounded-3xl border border-border/70 bg-card p-6 shadow-sm sm:p-8">
            <div className="mb-4 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
              <span className="rounded-full bg-muted px-3 py-1 font-medium tabular-nums">
                #{episode.orderIndex}
              </span>
              <span
                className={
                  episode.price > 0
                    ? "rounded-full bg-warning/15 px-3 py-1 font-medium text-warning"
                    : "rounded-full bg-success/15 px-3 py-1 font-medium text-success"
                }
              >
                {priceLabel}
              </span>
              <span>
                公開{" "}
                {formatDateTime(episode.publishedAt, {
                  fallback: "未設定",
                  timeZone,
                })}
              </span>
            </div>
            <h1 className="mb-3 font-serif text-3xl font-bold tracking-tight sm:text-4xl">
              {episode.title}
            </h1>
            <p className="text-sm text-muted-foreground sm:text-base">
              シリーズ「{series.title}」のエピソードです。
            </p>
          </header>

          <section aria-label="エピソード本文">
            {purchaseSearchParams.checkout === "success" ? (
              <output className="rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-success">
                決済を確認しています。購入が反映されると本文を表示します。
              </output>
            ) : null}
            {purchaseSearchParams.checkout === "cancelled" ? (
              <output className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
                購入手続きをキャンセルしました。料金は発生していません。
              </output>
            ) : null}
            {purchaseSearchParams.checkout === "error" ? (
              <p
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                購入手続きを開始できませんでした。時間をおいて再試行してください。
              </p>
            ) : null}
            <SectionErrorBoundary title="本文を表示できませんでした">
              <Suspense fallback={<EpisodeBodySkeleton />}>
                <EpisodeBody
                  access={access}
                  acceptsPayments={tenant?.acceptsPayments ?? false}
                  checkoutSessionId={
                    purchaseSearchParams.checkout === "success"
                      ? purchaseSearchParams.session_id
                      : ""
                  }
                  episodePublicId={episode.publicId}
                  episodeTitle={episode.title}
                  images={images}
                  seriesPublicId={series.publicId}
                  tenantId={tenantId}
                />
              </Suspense>
            </SectionErrorBoundary>
          </section>
        </article>

        <aside className="order-1 lg:order-2">
          <div className="space-y-4 lg:sticky lg:top-8">
            <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
              <p className="mb-2 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                Series
              </p>
              <h2 className="mb-3 font-serif text-2xl font-semibold">
                {series.title}
              </h2>
              <Link
                href={`/series/${series.publicId}`}
                className="text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                シリーズ詳細へ
              </Link>
            </section>

            <section className="rounded-3xl border border-border/70 bg-card p-5 shadow-sm">
              <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                Episode Info
              </p>
              <dl className="space-y-4 text-sm">
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">価格</dt>
                  <dd
                    className={
                      episode.price > 0
                        ? "font-medium text-warning"
                        : "font-medium text-success"
                    }
                  >
                    {priceLabel}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">公開日</dt>
                  <dd className="text-right font-medium">
                    {formatDateTime(episode.publishedAt, {
                      fallback: "未設定",
                      timeZone,
                    })}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-4">
                  <dt className="text-muted-foreground">閲覧期限</dt>
                  <dd className="text-right font-medium">
                    {episode.readingPeriodHours > 0
                      ? `${episode.readingPeriodHours}時間`
                      : "制限なし"}
                  </dd>
                </div>
                {isPublicEpisodeBody(access) ? (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">本文枚数</dt>
                    <dd className="font-medium">{images.length}枚</dd>
                  </div>
                ) : null}
                {episode.scheduledAt && (
                  <div className="flex items-start justify-between gap-4">
                    <dt className="text-muted-foreground">公開予定</dt>
                    <dd className="text-right font-medium">
                      {formatDateTime(episode.scheduledAt, {
                        fallback: "未設定",
                        timeZone,
                      })}
                    </dd>
                  </div>
                )}
              </dl>
            </section>
          </div>
        </aside>
      </div>
    </main>
  );
};

const Page = (
  props: PageProps<"/[tenant_id]/series/[series_id]/episodes/[episode_id]">
) => (
  <Suspense fallback={<EpisodeSkeleton />}>
    <EpisodeContent {...props} />
  </Suspense>
);

export default Page;
