import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { EyeCatchPicture } from "#components/eye-catch-picture";
import { listPublishedLabels } from "#lib/catalog";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

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

const LabelsListData = async () => {
  const tenantId = await getTenantId();
  const labels = await listPublishedLabels(tenantId);

  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        レーベルはまだ登録されていません。
      </p>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {labels.map((label) => (
        <article
          key={label.publicId}
          className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
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
              <svg
                aria-hidden="true"
                className="h-12 w-12"
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
            <h2 className="font-serif text-lg font-semibold">{label.name}</h2>
          </div>
        </article>
      ))}
    </div>
  );
};

const LabelsPage = () => (
  <main className="mx-auto max-w-6xl px-6 py-12">
    <h1 className="mb-2 font-serif text-4xl font-bold">レーベル一覧</h1>
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
      のレーベルをご紹介します
    </p>

    <Suspense fallback={<LabelsListSkeleton />}>
      <LabelsListData />
    </Suspense>
  </main>
);

export default LabelsPage;
