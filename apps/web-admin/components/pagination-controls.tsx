import { Button, LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import type { CursorPageHrefs } from "#lib/cursor-page";

const PageControl = ({
  children,
  href,
}: {
  children: ReactNode;
  href?: string;
}) =>
  href ? (
    <LinkButton render={<Link href={href} />} size="sm" variant="outline">
      {children}
    </LinkButton>
  ) : (
    <Button disabled size="sm" variant="outline">
      {children}
    </Button>
  );

/**
 * The links to the pages around the current one. `aria-label` names the list
 * they page through, since a screen can carry more than one pager.
 */
export const PaginationControls = ({
  "aria-label": ariaLabel,
  nextHref,
  previousHref,
}: CursorPageHrefs & {
  "aria-label": string;
}) => (
  <nav aria-label={ariaLabel} className="flex justify-end gap-2">
    <PageControl href={previousHref}>
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message="admin.common.previous" />
      </Suspense>
    </PageControl>
    <PageControl href={nextHref}>
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message="admin.common.next" />
      </Suspense>
    </PageControl>
  </nav>
);

/**
 * The footer every cursor-paginated list carries: what one page holds, and the
 * links to the pages around it.
 *
 * Render it whenever the list has rows **or** page links. Keeping it on an
 * empty page matters: the server hands back a recovery token when the row a
 * token pointed at is gone, and hiding the links would leave that page with no
 * way back into the list.
 *
 * ```tsx
 * <PaginationFooter>
 *   <PaginationFooterDescription>…</PaginationFooterDescription>
 *   <PaginationControls aria-label={…} nextHref={…} previousHref={…} />
 * </PaginationFooter>
 * ```
 */
export const PaginationFooter = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    {children}
  </div>
);

/** What one page holds. */
export const PaginationFooterDescription = ({
  children,
}: {
  children: ReactNode;
}) => <p className="text-sm text-muted-foreground">{children}</p>;
