"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import Link from "next/link";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";

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
 *
 * The tenant member manager renders it from a Client Component, so the
 * Previous and Next labels come from the catalog provider, not `<Message>`.
 */
export const PaginationControls = ({
  "aria-label": ariaLabel,
  nextHref,
  previousHref,
}: {
  "aria-label": string;
  nextHref?: string;
  previousHref?: string;
}) => {
  const t = useClientMessages();

  return (
    <nav aria-label={ariaLabel} className="flex justify-end gap-2">
      <PageControl href={previousHref}>
        {t("platform.common.previous")}
      </PageControl>
      <PageControl href={nextHref}>{t("platform.common.next")}</PageControl>
    </nav>
  );
};
