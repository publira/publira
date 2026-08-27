import { Button, LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";
import type { CursorPageHrefs } from "#lib/cursor-page";

const PageControl = ({ href, label }: { href?: string; label: ReactNode }) =>
  href ? (
    <LinkButton render={<Link href={href} />} size="sm" variant="outline">
      {label}
    </LinkButton>
  ) : (
    <Button disabled size="sm" variant="outline">
      {label}
    </Button>
  );

export const PaginationControls = ({
  ariaLabel,
  nextHref,
  previousHref,
}: CursorPageHrefs & {
  ariaLabel: string;
}) => (
  <nav aria-label={ariaLabel} className="flex justify-end gap-2">
    <PageControl
      href={previousHref}
      label={
        <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
          <Message message="admin.common.previous" />
        </Suspense>
      }
    />
    <PageControl
      href={nextHref}
      label={
        <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
          <Message message="admin.common.next" />
        </Suspense>
      }
    />
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
 */
export const PaginationFooter = ({
  ariaLabel,
  description,
  nextHref,
  previousHref,
}: CursorPageHrefs & {
  ariaLabel: string;
  description: ReactNode;
}) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <p className="text-sm text-muted-foreground">{description}</p>
    <PaginationControls
      ariaLabel={ariaLabel}
      nextHref={nextHref}
      previousHref={previousHref}
    />
  </div>
);
