import { Button, LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

import type { CursorPageHrefs } from "#lib/cursor-page";

const PageControl = ({ href, label }: { href?: string; label: string }) =>
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
    <PageControl href={previousHref} label="前へ" />
    <PageControl href={nextHref} label="次へ" />
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
  description: string;
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
