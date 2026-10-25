import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The breakdowns a report can be read in — by day, by series — as links, so
 * the one chosen is in the URL beside the period and the sort.
 */
const GroupNav = ({
  "aria-label": label,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) => (
  <nav aria-label={label} className="flex flex-wrap gap-2">
    {children}
  </nav>
);

const GroupNavLink = ({
  children,
  current,
  href,
}: {
  children: ReactNode;
  current: boolean;
  href: string;
}) => (
  <LinkButton
    aria-current={current ? "page" : undefined}
    render={<Link href={href} scroll={false} />}
    size="sm"
    variant={current ? "default" : "outline"}
  >
    {children}
  </LinkButton>
);

export { GroupNav as Root, GroupNavLink as Link };
