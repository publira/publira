import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The ways a screen can be read — a report by day or by series, a list by the
 * kind of its lines — as links, so the one chosen is in the URL beside the
 * screen's other state.
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
