import {
  createPlaceholderStaticParams,
  guardPlaceholder,
} from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import Image from "next/image";
import { Suspense } from "react";

import { listPublishedLabels } from "#lib/catalog";
import { getTenantSiteLabel } from "#lib/tenant";

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_public_id");

export const generateMetadata = async ({
  params,
}: {
  params: Promise<{ tenant_public_id: string }>;
}): Promise<Metadata> => {
  const { tenant_public_id } = await params;
  guardPlaceholder(tenant_public_id);

  const siteLabel = await getTenantSiteLabel(tenant_public_id);

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

const LabelsListData = async (
  props: PageProps<"/[tenant_public_id]/labels">
) => {
  const { tenant_public_id } = await props.params;
  guardPlaceholder(tenant_public_id);

  const labels = await listPublishedLabels(tenant_public_id);

  if (labels.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border/80 bg-muted/20 px-4 py-8 text-center text-sm text-muted-foreground">
        レーベルはまだ登録されていません。
      </p>
    );
  }

  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {labels.map((label) => {
        const landscapeVariant = label.eyeCatchImageVariants?.find(
          (variant) => variant.variantType === "landscape"
        );
        const fallbackVariant = label.eyeCatchImageVariants?.[0];
        const imageVariant = landscapeVariant || fallbackVariant;

        return (
          <article
            key={label.publicId}
            className="overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm"
          >
            {imageVariant ? (
              <div className="relative aspect-video overflow-hidden bg-muted">
                <Image
                  alt={label.name}
                  className="h-full w-full object-cover"
                  height={imageVariant.height}
                  loading="lazy"
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  src={imageVariant.url}
                  unoptimized
                  width={imageVariant.width}
                />
              </div>
            ) : (
              <div className="flex aspect-video items-center justify-center bg-linear-to-br from-primary/20 to-primary/10 text-primary/40">
                <svg
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
        );
      })}
    </div>
  );
};

export default async function LabelsPage(
  props: PageProps<"/[tenant_public_id]/labels">
) {
  const { tenant_public_id } = await props.params;
  guardPlaceholder(tenant_public_id);

  const siteLabel = await getTenantSiteLabel(tenant_public_id);

  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-2 font-serif text-4xl font-bold">レーベル一覧</h1>
      <p className="mb-8 text-muted-foreground">
        {siteLabel} のレーベルをご紹介します
      </p>

      <Suspense fallback={<LabelsListSkeleton />}>
        <LabelsListData {...props} />
      </Suspense>
    </main>
  );
}
