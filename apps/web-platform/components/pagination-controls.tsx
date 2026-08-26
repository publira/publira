import { Button, LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

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
  nextLabel,
  previousHref,
  previousLabel,
}: {
  ariaLabel: string;
  nextHref?: string;
  nextLabel: ReactNode;
  previousHref?: string;
  previousLabel: ReactNode;
}) => (
  <nav aria-label={ariaLabel} className="flex justify-end gap-2">
    <PageControl href={previousHref} label={previousLabel} />
    <PageControl href={nextHref} label={nextLabel} />
  </nav>
);
