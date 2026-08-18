import { ImageIcon } from "@publira/icons";
import {
  createPlaceholderStaticParams,
  guardPlaceholders,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { PageLoadError } from "#components/page-load-error";
import { getPublishedLabelDetail } from "#lib/labels";
import type { PublishedLabelDetail } from "#lib/labels";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  labelDetailHref,
  parseLabelDetailParams,
  parseLabelDetailSearchParams,
} from "./_lib/search-params";

const LABEL_SERIES_PAGE_SIZE = 20;

type LabelDetailPageProps = PageProps<"/[tenant_id]/labels/[label_id]">;

/**
 * `"use cache"` keys on the serialized arguments, so metadata and the page
 * body have to pass the same `{ limit, token }` or one request fills two
 * entries and hits the RPC twice.
 */
const loadPublishedLabelDetail = (
  tenantId: string,
  labelId: string,
  token: string
) =>
  getPublishedLabelDetail(tenantId, labelId, {
    limit: LABEL_SERIES_PAGE_SIZE,
    token,
  });

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id", "label_id");

export const generateMetadata = async ({
  params,
  searchParams,
}: LabelDetailPageProps): Promise<Metadata> => {
  const [{ label_id }, tenantId, resolvedSearchParams] = await Promise.all([
    params,
    getTenantId(),
    searchParams,
  ]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });
  const { token } = parseLabelDetailSearchParams(resolvedSearchParams);

  const [siteLabel, result] = await Promise.all([
    getTenantSiteLabel(tenantId),
    labelId
      ? loadPublishedLabelDetail(tenantId, labelId, token)
      : Promise.resolve({ ok: true as const, value: null }),
  ]);

  // An unavailable label reads as "not found" for the `<title>` alone; the
  // page body below says what actually happened.
  const label = result.ok ? result.value : null;

  if (!label) {
    return {
      title: `レーベルが見つかりません | ${siteLabel}`,
    };
  }

  return {
    description: `${label.name} の公開中シリーズ ${label.seriesCount} 件`,
    title: `${label.name} | ${siteLabel}`,
  };
};

const LabelDetailSkeleton = () => (
  <div className="mx-auto max-w-5xl px-6 py-12">
    <div className="mb-10 overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
      <div className="aspect-video animate-pulse bg-muted" />
      <div className="space-y-4 p-8">
        <div className="h-9 w-1/2 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
      </div>
    </div>
    <div className="grid gap-4">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          className="h-20 animate-pulse rounded-2xl border border-border/70 bg-muted/40"
          key={index}
        />
      ))}
    </div>
  </div>
);

const LabelSeriesPagination = ({
  labelId,
  nextToken,
  previousToken,
}: {
  labelId: string;
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="所属シリーズページング"
    className="mt-8 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        href={labelDetailHref(labelId, previousToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        href={labelDetailHref(labelId, nextToken)}
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const LabelRelatedSeries = ({
  label,
  token,
}: {
  label: PublishedLabelDetail;
  token: string;
}) => {
  if (label.series.length === 0) {
    if (!token) {
      return (
        <div className="rounded-2xl border border-dashed border-border/80 bg-muted/20 p-6 text-sm text-muted-foreground">
          まだ公開中シリーズはありません。
        </div>
      );
    }

    return (
      <div className="py-10 text-center">
        <p className="mb-4 text-sm text-muted-foreground">
          このページに表示できるシリーズがありません。
        </p>
        {label.previousToken || label.nextToken ? (
          <LabelSeriesPagination
            labelId={label.id}
            nextToken={label.nextToken}
            previousToken={label.previousToken}
          />
        ) : (
          <Link
            href={labelDetailHref(label.id, "")}
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            所属シリーズの先頭へ
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <ul className="grid gap-4">
        {label.series.map((series) => (
          <li key={series.publicId}>
            <Link
              href={`/series/${series.publicId}`}
              className="block rounded-2xl border border-border/70 bg-card p-5 transition hover:border-secondary/40 hover:shadow-sm"
            >
              <p className="font-medium text-foreground">{series.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                シリーズ詳細を見る
              </p>
            </Link>
          </li>
        ))}
      </ul>
      <LabelSeriesPagination
        labelId={label.id}
        nextToken={label.nextToken}
        previousToken={label.previousToken}
      />
    </>
  );
};

const LabelDetailContent = async ({
  params,
  searchParams,
}: LabelDetailPageProps) => {
  const [{ label_id }, tenantId, resolvedSearchParams] = await Promise.all([
    params,
    getTenantId(),
    searchParams,
  ]);

  guardPlaceholders({ label_id });

  const labelId = parseLabelDetailParams({ label_id });
  const { token } = parseLabelDetailSearchParams(resolvedSearchParams);

  if (!labelId) {
    notFound();
  }

  // A failed read is a value, not a throw: a `"use cache"` fill that throws
  // fails the whole request, so neither this page nor any boundary would get
  // to render anything (#672).
  const [siteLabel, result] = await Promise.all([
    getTenantSiteLabel(tenantId),
    loadPublishedLabelDetail(tenantId, labelId, token),
  ]);

  if (!result.ok) {
    return <PageLoadError description={result.message} />;
  }

  const label = result.value;

  if (!label) {
    notFound();
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-12">
      <section className="mb-10 overflow-hidden rounded-3xl border border-border/70 bg-card/90 shadow-sm">
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
            <ImageIcon className="h-16 w-16" />
          </div>
        )}
        <div className="p-8">
          <p className="mb-3 text-xs tracking-[0.24em] text-muted-foreground uppercase">
            {siteLabel}
          </p>
          <h1 className="mb-2 font-serif text-4xl font-bold text-foreground">
            {label.name}
          </h1>
          <p className="text-sm text-muted-foreground">
            公開中シリーズ {label.seriesCount} 件
          </p>
        </div>
      </section>

      <section>
        <div className="mb-5">
          <h2 className="font-serif text-2xl font-semibold">所属シリーズ</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            このレーベルに属する公開中シリーズ一覧です。
          </p>
        </div>

        <LabelRelatedSeries label={label} token={token} />
      </section>

      <div className="mt-8">
        <Link
          href="/labels"
          className="text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          レーベル一覧へ戻る
        </Link>
      </div>
    </main>
  );
};

const Page = (props: LabelDetailPageProps) => (
  <Suspense fallback={<LabelDetailSkeleton />}>
    <LabelDetailContent {...props} />
  </Suspense>
);

export default Page;
