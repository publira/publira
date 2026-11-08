import { LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { JSX, ReactNode } from "react";

export const SiteLayoutActions = ({
  children,
}: {
  children: ReactNode;
}): JSX.Element => <div className="flex items-center gap-2">{children}</div>;

/** The one filled button in the header, in ink. */
export const SiteLayoutPrimaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}): JSX.Element => (
  <LinkButton render={<Link href={href} />} variant="ink">
    {children}
  </LinkButton>
);

/** The action beside the filled one, carried by its label alone. */
export const SiteLayoutSecondaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}): JSX.Element => (
  <LinkButton render={<Link href={href} />} variant="ghost">
    {children}
  </LinkButton>
);
