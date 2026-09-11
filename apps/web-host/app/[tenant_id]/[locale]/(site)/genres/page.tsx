import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
} from "@publira/ui-components/empty-state";
import {
  SectionError,
  SectionErrorDescription,
  SectionErrorHeading,
  SectionErrorTitle,
} from "@publira/ui-components/section-error";
import { Skeleton, SkeletonLine } from "@publira/ui-components/skeleton";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import { Suspense } from "react";

import { GenreChips } from "#components/genre-chips";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedGenres } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

/** Enough chips to fill the row a phone shows while the read comes back. */
const GENRE_SKELETON_COUNT = 8;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.genres.list_title") };
};

const GenreChipsSkeleton = () => (
  <div aria-hidden="true" className="flex flex-wrap gap-2">
    {Array.from({ length: GENRE_SKELETON_COUNT }, (_, index) => (
      <Skeleton className="h-9 w-28 rounded-control" key={index} />
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const GenresListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.genres.list_description", {
    site: siteLabel,
  });
};

const GenresListData = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const result = await listPublishedGenres(tenantId, locale);

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.genres.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  if (result.value.length === 0) {
    return (
      <EmptyState>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
            <Message message="host.genres.list_empty" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyState>
    );
  }

  return <GenreChips genres={result.value} />;
};

const GenresPage = () => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="host.genres.list_title" />
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
          <Message message="host.genres.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<GenreChipsSkeleton />}>
        <GenresListData />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default GenresPage;
