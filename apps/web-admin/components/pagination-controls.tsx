import { Button, LinkButton } from "@publira/ui-components/button";
import Link from "next/link";

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
}: {
  ariaLabel: string;
  nextHref?: string;
  previousHref?: string;
}) => (
  <nav aria-label={ariaLabel} className="flex justify-end gap-2">
    <PageControl href={previousHref} label="前へ" />
    <PageControl href={nextHref} label="次へ" />
  </nav>
);
