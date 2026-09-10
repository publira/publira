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
import { searchPublishedSeries } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import type { SearchGroupView } from "../_lib/search-group";
import { searchPageHref } from "../_lib/search-params";

/** One cursor page of the series group's own view. */
const SERIES_PAGE_SIZE = 20;

/** How many series the overview shows before the link into that view. */
const SERIES_OVERVIEW_SIZE = 5;

/** Enough rows to fill a phone screen while the read comes back. */
const SERIES_SKELETON_COUNT = 5;

export const SeriesResultsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: SERIES_SKELETON_COUNT }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </div>
    ))}
  </div>
);

/**
 * The pagination's `<nav>`, and the one place this group resolves the catalog
 * for a value that cannot be a node: an `aria-label`. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const SeriesPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.search.series_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this group shows them. */
const SeriesPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <SeriesPaginationNav>
      <ListPaginationStep
        href={
          previousToken ? searchPageHref(query, "series", previousToken) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? searchPageHref(query, "series", nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </SeriesPaginationNav>
  </Suspense>
);

/**
 * The series that match the keyword.
 *
 * In `page` view this is the whole group, one cursor page at a time. In
 * `overview` view it is the first few rows, and the link under them appears
 * only when the server hands back a next token — a "show all" that leads to the
 * same rows the reader is already looking at is a dead end.
 */
export const SeriesResults = async ({
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

  const result = await searchPublishedSeries(tenantId, {
    limit: overview ? SERIES_OVERVIEW_SIZE : SERIES_PAGE_SIZE,
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
              <Message message="host.search.series_error" />
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
              <Message
                message="host.search.series_no_results"
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
              <Message message="host.series.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <SeriesPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={searchPageHref(query, "series")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.search.series_first_page" />
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
        {series.map((item) => (
          <li key={item.publicId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/series/${item.publicId}`}
            >
              <EyeCatchFrame
                // The title is beside it in the row, so repeating it here
                // would read every result out twice.
                alt=""
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={item.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-serif leading-tight underline-offset-4 group-hover:underline">
                  {item.title}
                </span>
                {item.creatorNames.length > 0 && (
                  <span className="mt-1 block truncate text-sm text-muted-foreground">
                    {formatList(item.creatorNames, { locale })}
                  </span>
                )}
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
              href={searchPageHref(query, "series")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="host.search.series_show_all" />
              </Suspense>
            </LocaleLink>
          </p>
        )
      ) : (
        <SeriesPagination
          nextToken={nextToken}
          previousToken={previousToken}
          query={query}
        />
      )}
    </div>
  );
};
