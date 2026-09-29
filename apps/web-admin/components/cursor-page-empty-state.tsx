import {
  EmptyState,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

interface CursorPageEmptyStateProps {
  /**
   * The empty state of the whole list — its `EmptyStateHeading` and, where a
   * record can be created, its `EmptyStateActions`.
   */
  children: ReactNode;
  hasPageLinks: boolean;
  /** The list's name, interpolated into the wording of a page that lost its rows. */
  itemLabel: string;
}

/**
 * The empty state of a cursor-paginated list, worded for the two cases a screen
 * cannot tell apart from the row count alone.
 *
 * Without page links the list holds every row it has, so an empty page means
 * nothing is registered yet and the caller's `children` (with its "create one"
 * action) are right. With page links the list only lost the rows this page
 * pointed at, and the way out is the pager rather than a new record — so the
 * children are dropped for this component's own wording.
 *
 * ```tsx
 * <CursorPageEmptyState hasPageLinks={…} itemLabel={…}>
 *   <EmptyStateHeading>
 *     <EmptyStateTitle>…</EmptyStateTitle>
 *     <EmptyStateDescription>…</EmptyStateDescription>
 *   </EmptyStateHeading>
 *   <EmptyStateActions>…</EmptyStateActions>
 * </CursorPageEmptyState>
 * ```
 */
export const CursorPageEmptyState = ({
  children,
  hasPageLinks,
  itemLabel,
}: CursorPageEmptyStateProps) => (
  <EmptyState>
    {hasPageLinks ? (
      <EmptyStateHeading>
        <EmptyStateTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message
              message="admin.common.page_empty_title"
              values={{ item: itemLabel }}
            />
          </Suspense>
        </EmptyStateTitle>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
            <Message message="admin.common.page_empty_description" />
          </Suspense>
        </EmptyStateDescription>
      </EmptyStateHeading>
    ) : (
      children
    )}
  </EmptyState>
);
