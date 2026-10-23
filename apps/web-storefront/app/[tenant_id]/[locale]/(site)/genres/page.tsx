import * as EmptyState from "@publira/ui-components/empty-state";
import * as SectionError from "@publira/ui-components/section-error";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedGenres } from "#lib/catalog";
import { getMessages } from "#lib/get-messages";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import { getPageAlternates } from "#lib/page-alternates";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import { GenreTiles, GenreTilesSkeleton } from "./_components/genre-tiles";

/** Two rows of tiles on a desktop while the read comes back. */
const GENRE_SKELETON_COUNT = 8;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const [t, alternates] = await Promise.all([
    getMessages(),
    getPageAlternates("/genres"),
  ]);

  return { alternates, title: t("storefront.genres.list_title") };
};

/**
 * The tenant's name sits inside the sentence, and the locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const GenresListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, t] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    getMessagesFor(locale),
  ]);

  return t("storefront.genres.list_description", {
    site: siteLabel,
  });
};

const GenresListData = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await listPublishedGenres(tenantId, locale);

  if (!result.ok) {
    return (
      <SectionError.Root>
        <SectionError.Heading>
          <SectionError.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="storefront.genres.list_error" />
            </Suspense>
          </SectionError.Title>
          <SectionError.Description>{result.message}</SectionError.Description>
        </SectionError.Heading>
      </SectionError.Root>
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState.Root>
        <EmptyState.Description>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="storefront.genres.list_empty" />
          </Suspense>
        </EmptyState.Description>
      </EmptyState.Root>
    );
  }

  return <GenreTiles genres={result.value} />;
};

const GenresPage = () => (
  <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="storefront.genres.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <GenresListDescription />
        </Suspense>
      </p>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="storefront.genres.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<GenreTilesSkeleton count={GENRE_SKELETON_COUNT} />}>
        <GenresListData />
      </Suspense>
    </SectionErrorBoundary>
  </div>
);

export default GenresPage;
