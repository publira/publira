import { ImageIcon } from "@publira/icons";
import { SectionError } from "@publira/ui-components/section-error";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedLabels } from "#lib/catalog";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  labelsListHref,
  parseLabelsListSearchParams,
} from "./_lib/search-params";

const LABELS_PAGE_SIZE = 24;
const SECTION_TITLE = "レーベル一覧を表示できませんでした";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const tenantId = await getTenantId();

  const siteLabel = await getTenantSiteLabel(tenantId);

  return {
    title: `レーベル一覧 | ${siteLabel}`,
  };
};

const LabelsListSkeleton = () => (
  <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
    {Array.from({ length: 6 }, (_, i) => (
      <div
        key={i}
        className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
      >
        <div className="aspect-video animate-pulse bg-muted" />
        <div className="p-4">
          <div className="h-5 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
    ))}
  </div>
);

const TenantSiteLabel = async () => {
  const tenantId = await getTenantId();
  return getTenantSiteLabel(tenantId);
};

const LabelsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <nav
    aria-label="レーベル一覧ページング"
    className="mt-8 flex items-center justify-center gap-6"
  >
    {previousToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={labelsListHref(previousToken)}
      >
        前のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">前のページ</span>
    )}

    {nextToken ? (
      <Link
        className="text-sm text-primary underline-offset-4 hover:underline"
        href={labelsListHref(nextToken)}
      >
        次のページ
      </Link>
    ) : (
      <span className="text-sm text-muted-foreground">次のページ</span>
    )}
  </nav>
);

const LabelsListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/labels">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId] = await Promise.all([
    searchParams,
    getTenantId(),
  ]);
  const { token } = parseLabelsListSearchParams(resolvedSearchParams);
  const result = await listPublishedLabels(tenantId, {
    limit: LABELS_PAGE_SIZE,
    token,
  });

  if (!result.ok) {
    return <SectionError description={result.message} title={SECTION_TITLE} />;
  }

  const { labels, nextToken, previousToken } = result.value;

  if (labels.length === 0) {
    if (!token) {
      return (
        <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
          レーベルはまだ登録されていません。
        </p>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="py-20 text-center">
        <p className="mb-4 text-muted-foreground">
          このページに表示できるレーベルがありません。
        </p>
        {previousToken || nextToken ? (
          <LabelsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <Link
            className="text-sm text-primary underline-offset-4 hover:underline"
            href={labelsListHref("")}
          >
            レーベル一覧の先頭へ
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {labels.map((label) => (
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
                <ImageIcon className="h-12 w-12" />
              </div>
            )}
            <div className="p-4">
              <h2 className="font-serif text-lg font-semibold">{label.name}</h2>
            </div>
          </Link>
        ))}
      </div>

      <LabelsPagination nextToken={nextToken} previousToken={previousToken} />
    </>
  );
};

const LabelsPage = ({ searchParams }: PageProps<"/[tenant_id]/labels">) => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">レーベル一覧</h1>
    <p className="mb-8 text-muted-foreground">
      <Suspense
        fallback={
          <span
            aria-hidden
            className="inline-block h-4 w-16 animate-pulse rounded bg-muted align-middle"
          />
        }
      >
        <TenantSiteLabel />
      </Suspense>
      のレーベルをご紹介します
    </p>

    <SectionErrorBoundary title={SECTION_TITLE}>
      <Suspense fallback={<LabelsListSkeleton />}>
        <LabelsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default LabelsPage;
