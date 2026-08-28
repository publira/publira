"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

export const SiteLayoutActions = ({ children }: { children: ReactNode }) => (
  <div className="flex items-center gap-2">{children}</div>
);

export const SiteLayoutPrimaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <LinkButton render={<Link href={href} />} size="sm">
    {children}
  </LinkButton>
);

export const SiteLayoutSecondaryAction = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <LinkButton render={<Link href={href} />} size="sm" variant="secondary">
    {children}
  </LinkButton>
);

export const SiteLayoutLogoutAction = ({
  action,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>;
  children: ReactNode;
}) => (
  <form action={action}>
    <Button size="sm" type="submit" variant="secondary">
      {children}
    </Button>
  </form>
);
