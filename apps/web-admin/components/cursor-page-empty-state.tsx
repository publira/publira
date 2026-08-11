import { EmptyState } from "@publira/ui-components/empty-state";
import type { ReactNode } from "react";

interface CursorPageEmptyStateProps {
  actions?: ReactNode;
  description: ReactNode;
  hasPageLinks: boolean;
  itemLabel: string;
  // `EmptyState` inherits the `title` attribute of a `div`, so this stays a
  // plain string rather than the `ReactNode` the other slots take.
  title: string;
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
    <EmptyState
      description="表示中に他の操作で削除された可能性があります。前後のページへ移動してください。"
      title={`このページに表示できる${itemLabel}はありません。`}
    />
  ) : (
    <EmptyState actions={actions} description={description} title={title} />
  );
