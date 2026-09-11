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
import type { ReactNode } from "react";
import { Suspense } from "react";

import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { searchPublishedCreators } from "#lib/creators";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import type { SearchGroupView } from "../_lib/search-group";
import { searchPageHref } from "../_lib/search-params";

/** One cursor page of the creator group's own view. */
const CREATORS_PAGE_SIZE = 20;

/** How many creators the overview shows before the link into that view. */
const CREATORS_OVERVIEW_SIZE = 5;

/** Enough rows to fill a phone screen while the read comes back. */
const CREATORS_SKELETON_COUNT = 5;

export const CreatorResultsSkeleton = () => (
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
 * The pagination's `<nav>`, and the one place this group resolves the catalog
 * for a value that cannot be a node: an `aria-label`. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const CreatorPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.search.creators_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this group shows them. */
const CreatorPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <CreatorPaginationNav>
      <ListPaginationStep
        href={
          previousToken ? searchPageHref(query, "creators", previousToken) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? searchPageHref(query, "creators", nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </CreatorPaginationNav>
  </Suspense>
);

/**
 * The credited creators whose name matches the keyword. This is the group that
 * answers a reader who typed a name rather than a title, so it stands on its
 * own: a keyword that matches no series at all still brings the creator back.
 *
 * In `page` view this is the whole group, one cursor page at a time. In
 * `overview` view it is the first few rows, and the link under them appears
 * only when the server hands back a next token — a "show all" that leads to the
 * same rows the reader is already looking at is a dead end.
 */
export const CreatorResults = async ({
  query,
  token,
  view,
}: {
  query: string;
  token: string;
  view: SearchGroupView;
}) => {
  const [tenantId, locale] = await Promise.all([getTenantId(), getLocale()]);
  const overview = view === "overview";

  const result = await searchPublishedCreators(tenantId, {
    limit: overview ? CREATORS_OVERVIEW_SIZE : CREATORS_PAGE_SIZE,
    locale,
    query,
    token,
  });

  if (!result.ok) {
    return (
      <SectionError>
        <SectionErrorHeading>
          <SectionErrorTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <Message message="host.search.creators_error" />
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
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="host.search.creators_no_results"
                values={{ query }}
              />
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
              <Message message="host.creators.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <CreatorPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={searchPageHref(query, "creators")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.search.creators_first_page" />
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

      {overview ? (
        nextToken && (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={searchPageHref(query, "creators")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="host.search.creators_show_all" />
              </Suspense>
            </LocaleLink>
          </p>
        )
      ) : (
        <CreatorPagination
          nextToken={nextToken}
          previousToken={previousToken}
          query={query}
        />
      )}
    </div>
  );
};
