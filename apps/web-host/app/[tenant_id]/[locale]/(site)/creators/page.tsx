import { getMessage } from "@publira/i18n";
import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
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
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { SectionErrorBoundary } from "#components/section-error-boundary";
import { listPublishedCreators } from "#lib/creators";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantSiteLabel } from "#lib/tenant";
import { getTenantId } from "#lib/tenant-id";

import {
  creatorsListHref,
  parseCreatorsListSearchParams,
} from "./_lib/search-params";

const CREATORS_PAGE_SIZE = 12;

/** Enough rows to fill a phone screen while the read comes back. */
const CREATORS_SKELETON_COUNT = 8;

export const generateStaticParams = () =>
  createPlaceholderStaticParams("tenant_id");

export const generateMetadata = async (): Promise<Metadata> => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return { title: getMessage(messages, "host.creators.list_title") };
};

const CreatorRowsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: CREATORS_SKELETON_COUNT }, (_, index) => (
      <div
        className="flex items-baseline justify-between gap-4 py-3"
        key={index}
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-24" />
      </div>
    ))}
  </div>
);

/**
 * The tenant's name sits inside the sentence, and the two locales put it in
 * different places, so the whole line resolves at once rather than streaming
 * the name into a fixed frame.
 */
const CreatorsListDescription = async () => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const [siteLabel, messages] = await Promise.all([
    getTenantSiteLabel(tenantId, locale),
    loadHostMessages(locale),
  ]);

  return getMessage(messages, "host.creators.list_description", {
    site: siteLabel,
  });
};

/**
 * The pagination's `<nav>`, and the one component on this screen that resolves
 * the catalog: an `aria-label` cannot be a node. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const CreatorsPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.creators.pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this screen shows them. */
const CreatorsPagination = ({
  nextToken,
  previousToken,
}: {
  nextToken: string;
  previousToken: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <CreatorsPaginationNav>
      <ListPaginationStep
        href={previousToken ? creatorsListHref(previousToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep href={nextToken ? creatorsListHref(nextToken) : ""}>
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </CreatorsPaginationNav>
  </Suspense>
);

const CreatorsListData = async ({
  searchParams,
}: {
  searchParams: PageProps<"/[tenant_id]/[locale]/creators">["searchParams"];
}) => {
  const [resolvedSearchParams, tenantId, locale] = await Promise.all([
    searchParams,
    getTenantId(),
    getLocale(),
  ]);
  const { token } = parseCreatorsListSearchParams(resolvedSearchParams);

  const result = await listPublishedCreators(tenantId, {
    limit: CREATORS_PAGE_SIZE,
    locale,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.creators.list_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { creators, nextToken, previousToken } = result.value;

  if (creators.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateHeading>
            <EmptyStateTitle>
              <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
                <Message message="host.creators.list_empty_title" />
              </Suspense>
            </EmptyStateTitle>
            <EmptyStateDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
                <Message message="host.creators.list_empty_description" />
              </Suspense>
            </EmptyStateDescription>
          </EmptyStateHeading>
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
              <Message message="host.creators.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <CreatorsPagination
            nextToken={nextToken}
            previousToken={previousToken}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={creatorsListHref("")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.creators.first_page" />
              </Suspense>
            </LocaleLink>
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-8">
      <ul className="divide-y divide-border border-t border-border">
        {creators.map((creator) => (
          <li key={creator.id}>
            <LocaleLink
              className="group flex items-baseline justify-between gap-4 py-3"
              href={`/creators/${creator.id}`}
            >
              <span className="truncate underline-offset-4 group-hover:underline">
                {creator.name}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message
                    message="host.common.series_count"
                    values={{ count: creator.seriesCount }}
                  />
                </Suspense>
              </span>
            </LocaleLink>
          </li>
        ))}
      </ul>

      <CreatorsPagination nextToken={nextToken} previousToken={previousToken} />
    </div>
  );
};

const CreatorsPage = ({
  searchParams,
}: PageProps<"/[tenant_id]/[locale]/creators">) => (
  <main className="mx-auto grid max-w-6xl gap-8 px-6 py-10">
    <div className="grid gap-2">
      <h1 className="font-serif text-3xl leading-tight">
        <Suspense fallback={<SkeletonLine className="h-8 w-32" />}>
          <Message message="host.creators.list_title" />
        </Suspense>
      </h1>
      <p className="text-muted-foreground">
        <Suspense fallback={<SkeletonLine className="h-5 w-80" />}>
          <CreatorsListDescription />
        </Suspense>
      </p>
    </div>

    <SectionErrorBoundary
      title={
        <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
          <Message message="host.creators.list_error" />
        </Suspense>
      }
    >
      <Suspense fallback={<CreatorRowsSkeleton />}>
        <CreatorsListData searchParams={searchParams} />
      </Suspense>
    </SectionErrorBoundary>
  </main>
);

export default CreatorsPage;
