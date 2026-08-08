"use client";

import { LinkButton } from "@publira/ui-components/button";

import type { LayoutActionItem } from "./site-layout";

interface SiteLayoutActionsProps {
  primaryAction: LayoutActionItem;
  secondaryAction: LayoutActionItem;
}

export const SiteLayoutActions = ({
  primaryAction,
  secondaryAction,
}: SiteLayoutActionsProps) => (
  <div className="flex items-center gap-2">
    <LinkButton
      // oxlint-disable-next-line jsx_a11y/anchor-has-content
      render={
        <a aria-label={secondaryAction.label} href={secondaryAction.href} />
      }
      size="sm"
      variant="secondary"
      className={secondaryAction.className}
    >
      {secondaryAction.label}
    </LinkButton>
    <LinkButton
      // oxlint-disable-next-line jsx_a11y/anchor-has-content
      render={<a aria-label={primaryAction.label} href={primaryAction.href} />}
      size="sm"
      className={primaryAction.className}
    >
      {primaryAction.label}
    </LinkButton>
  </div>
);
