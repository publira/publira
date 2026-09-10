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

import { EyeCatchFrame } from "#components/eye-catch-frame";
import {
  ListPagination,
  ListPaginationSkeleton,
  ListPaginationStep,
} from "#components/list-pagination";
import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import { searchPublishedLabels } from "#lib/catalog";
import { getLocale, loadHostMessages } from "#lib/locale";
import { getTenantId } from "#lib/tenant-id";

import type { SearchGroupView } from "../_lib/search-group";
import { searchPageHref } from "../_lib/search-params";

/** One cursor page of the label group's own view. */
const LABELS_PAGE_SIZE = 20;

/** How many labels the overview shows before the link into that view. */
const LABELS_OVERVIEW_SIZE = 5;

/** Enough rows to fill a phone screen while the read comes back. */
const LABELS_SKELETON_COUNT = 5;

export const LabelResultsSkeleton = () => (
  <div className="divide-y divide-border border-t border-border">
    {Array.from({ length: LABELS_SKELETON_COUNT }, (_, index) => (
      <div className="flex items-center gap-4 py-3" key={index}>
        <Skeleton className="size-14 shrink-0 rounded-control" />
        <Skeleton className="h-4 w-40" />
      </div>
    ))}
  </div>
);

/**
 * The pagination's `<nav>`, and the one place this group resolves the catalog
 * for a value that cannot be a node: an `aria-label`. The key stays written out
 * here, beside the `getMessage` that reads it.
 */
const LabelPaginationNav = async ({ children }: { children: ReactNode }) => {
  const locale = await getLocale();
  const messages = await loadHostMessages(locale);

  return (
    <ListPagination
      aria-label={getMessage(messages, "host.search.labels_pagination_aria")}
    >
      {children}
    </ListPagination>
  );
};

/** The two directions, written once for both places this group shows them. */
const LabelPagination = ({
  nextToken,
  previousToken,
  query,
}: {
  nextToken: string;
  previousToken: string;
  query: string;
}) => (
  <Suspense fallback={<ListPaginationSkeleton />}>
    <LabelPaginationNav>
      <ListPaginationStep
        href={
          previousToken ? searchPageHref(query, "labels", previousToken) : ""
        }
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
          <Message message="host.common.previous_page" />
        </Suspense>
      </ListPaginationStep>
      <ListPaginationStep
        href={nextToken ? searchPageHref(query, "labels", nextToken) : ""}
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
          <Message message="host.common.next_page" />
        </Suspense>
      </ListPaginationStep>
    </LabelPaginationNav>
  </Suspense>
);

/**
 * The labels whose name matches the keyword, narrowed to the ones that still
 * hold a published series.
 *
 * In `page` view this is the whole group, one cursor page at a time. In
 * `overview` view it is the first few rows, and the link under them appears
 * only when the server hands back a next token — a "show all" that leads to the
 * same rows the reader is already looking at is a dead end.
 */
export const LabelResults = async ({
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

  const result = await searchPublishedLabels(tenantId, {
    limit: overview ? LABELS_OVERVIEW_SIZE : LABELS_PAGE_SIZE,
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
              <Message message="host.search.labels_error" />
            </Suspense>
          </SectionErrorTitle>
          <SectionErrorDescription>{result.message}</SectionErrorDescription>
        </SectionErrorHeading>
      </SectionError>
    );
  }

  const { labels, nextToken, previousToken } = result.value;

  if (labels.length === 0) {
    if (!token) {
      return (
        <EmptyState>
          <EmptyStateDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
              <Message
                message="host.search.labels_no_results"
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
              <Message message="host.labels.page_empty" />
            </Suspense>
          </EmptyStateDescription>
        </EmptyState>
        {previousToken || nextToken ? (
          <LabelPagination
            nextToken={nextToken}
            previousToken={previousToken}
            query={query}
          />
        ) : (
          <p>
            <LocaleLink
              className="text-sm text-primary underline underline-offset-4"
              href={searchPageHref(query, "labels")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                <Message message="host.search.labels_first_page" />
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
        {labels.map((label) => (
          <li key={label.publicId}>
            <LocaleLink
              className="group flex items-center gap-4 py-3"
              href={`/labels/${label.publicId}`}
            >
              <EyeCatchFrame
                // The name is right beside it in the row, so the artwork
                // adds nothing a reader has not already been given.
                alt=""
                className="size-14 shrink-0 rounded-control"
                sizes="56px"
                variants={label.eyeCatchImageVariants}
              />
              <span className="min-w-0 flex-1 truncate underline-offset-4 group-hover:underline">
                {label.name}
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
              href={searchPageHref(query, "labels")}
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <Message message="host.search.labels_show_all" />
              </Suspense>
            </LocaleLink>
          </p>
        )
      ) : (
        <LabelPagination
          nextToken={nextToken}
          previousToken={previousToken}
          query={query}
        />
      )}
    </div>
  );
};
