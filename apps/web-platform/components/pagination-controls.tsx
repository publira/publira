import { Button, LinkButton } from "@publira/ui-components/button";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { Message } from "#components/message";

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
}: {
  "aria-label": string;
  nextHref?: string;
  previousHref?: string;
}) => (
  <nav aria-label={ariaLabel} className="flex justify-end gap-2">
    <PageControl href={previousHref}>
      <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
        <Message message="platform.common.previous" />
      </Suspense>
    </PageControl>
    <PageControl href={nextHref}>
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message="platform.common.next" />
      </Suspense>
    </PageControl>
  </nav>
);
