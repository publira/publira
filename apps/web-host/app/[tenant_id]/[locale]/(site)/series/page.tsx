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
import { formatList } from "@publira/utils";
import { createPlaceholderStaticParams } from "@publira/utils/next-static-params";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { EyeCatchFrame } from "#components/eye-catch-frame";
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  parseSeriesListSearchParams,
  seriesListHref,
} from "./_lib/search-params";

const SERIES_PAGE_SIZE = 24;

/** Half a page of covers: two shelves on a desktop, four rows on a phone. */
const SERIES_SKELETON_COUNT = 12;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.series.list_title") };
};

const SeriesShelfSkeleton = () => (
  <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
    {Array.from({ length: SERIES_SKELETON_COUNT }, (_, index) => (
      <div className="grid gap-2" key={index}>
        <Skeleton className="aspect-3/4 w-full rounded-surface" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-2/3" />
      </div>
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const SeriesListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.series.list_description", {
    site: siteLabel,
  });
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const SeriesPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.series.pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this screen shows them. */
const SeriesPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <SeriesPaginationNav>
      <ListPaginationStep
        href={previousToken ? seriesListHref(previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep href={nextToken ? seriesListHref(nextToken) : ""}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </SeriesPaginationNav>
  </Suspense>
);

const SeriesListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/series">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseSeriesListSearchParams(resolvedSearchParams);

  const result = await listPublishedSeries(tenantId, {
    limit: SERIES_PAGE_SIZE,
    locale,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.series.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { nextToken, previousToken, series } = result.value;

  if (series.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.list_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
      );
    }

    // The rows this page pointed at are gone. The server hands back a token for
    // the neighbouring page when it can, and empty tokens when it cannot — then
    // the only way out is the first page (`proto/README.md`).
    return (
      <div className="grid gap-8">
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message message="host.series.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <SeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={seriesListHref("")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.series.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ul className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-6">
        {series.map((item) => (
          <li key={item.publicId}>
            <LocaleLink
              className="group block"
              href={`/series/${item.publicId}`}
            >
              <EyeCatchFrame
                // The title is set beneath the cover, so repeating it here
                // would read the shelf out twice.
                alt=""
                className="aspect-3/4 w-full rounded-surface"
                preferredType="portrait"
                sizes="(max-width: 640px) 33vw, 16vw"
                variants={item.eyeCatchImageVariants}
              >
                <span className="line-clamp-4 font-serif text-xs leading-tight text-muted-foreground">
                  {item.title}
                </span>
              </EyeCatchFrame>
              <span className="mt-2 block font-serif text-sm leading-tight underline-offset-4 group-hover:underline">
                {item.title}
              </span>
              {item.creatorNames.length > 0 && (
                <span className="mt-1 block truncate text-xs text-muted-foreground">
                  {formatList(item.creatorNames, { locale })}
                </span>
              )}
            </LocaleLink>
          </li>
        ))}
      </ul>

      <SeriesPagination nextToken={nextToken} previousToken={previousToken} />
    </div>
  );
};

const SeriesPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/series">) => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-40" />}>
          <Message message="host.series.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <SeriesListDescription />
        </Suspense>
      </p>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.series.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<SeriesShelfSkeleton />}>
        <SeriesListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default SeriesPage;
