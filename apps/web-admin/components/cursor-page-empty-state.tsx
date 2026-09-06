import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

interface CursorPageEmptyStateProps {
  actions?: ReactNode;
  description: ReactNode;
  hasPageLinks: boolean;
  itemLabel: string;
  title: ReactNode;
}

/**
 * The empty state of a cursor-paginated list, worded for the two cases a screen
 * cannot tell apart from the row count alone.
 *
 * Without page links the list holds every row it has, so an empty page means
 * nothing is registered yet and the caller's own wording (plus its "create
 * one" action) is right. With page links the list only lost the rows this page
 * pointed at, and the way out is the pager rather than a new record — so the
 * create action is dropped and the wording says so.
 */
export const CursorPageEmptyState = ({
  actions,
  description,
  hasPageLinks,
  itemLabel,
  title,
}: CursorPageEmptyStateProps) =>
  hasPageLinks ? (
    <EmptyState>
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
    </EmptyState>
  ) : (
    <EmptyState>
      <EmptyStateHeading>
        <EmptyStateTitle>{title}</EmptyStateTitle>
        <EmptyStateDescription>{description}</EmptyStateDescription>
      </EmptyStateHeading>
      {actions ? <EmptyStateActions>{actions}</EmptyStateActions> : null}
    </EmptyState>
  );
