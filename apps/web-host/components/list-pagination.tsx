import { SkeletonLine } from "@publira/ui-components/skeleton";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import { LocaleLink } from "#components/locale-link";

/** The rule the pagination sits under, shared with its own skeleton. */
const rowClassName = cn(
  "flex items-baseline gap-6 border-t border-border pt-4"
);

/**
 * The pagination under a cursor list.
 *
 * A cursor list has no page numbers to set in ink, so the two directions are
 * all there is to render, and {@link ListPaginationStep} is what renders one.
 *
 * `aria-label` cannot be a node, so it arrives as the string it will be, under
 * its own attribute name because the element it lands on is this component's
 * root. The screen resolves it in a component of its own, which is what keeps
 * the catalog key written out beside the `getMessage` call that reads it — a
 * key handed across a file boundary is one `git grep` can no longer account
 * for.
 */
export const ListPagination = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) => (
  <nav aria-label={ariaLabel} className={rowClassName}>
    {children}
  </nav>
);

/** What stands in for the pagination while its `aria-label` resolves. */
export const ListPaginationSkeleton = () => (
  <div className={rowClassName}>
    <SkeletonLine className="h-4 w-24" />
    <SkeletonLine className="h-4 w-16" />
  </div>
);

/**
 * One direction of a cursor pagination.
 *
 * An empty `href` is the end of the list: the same words, in lighter ink and
 * without a link, so the pair keeps its shape wherever the reader is. The
 * words themselves are the caller's children, so the catalog key stays written
 * out at the call site.
 */
export const ListPaginationStep = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) =>
  href ? (
    <LocaleLink
      className="text-sm text-primary underline underline-offset-4"
      href={href}
    >
      {children}
    </LocaleLink>
  ) : (
    <span className="text-sm text-muted-foreground">{children}</span>
  );
