"use client";

import { LinkButton } from "@publira/ui-components/button";
import type { LinkButtonProps } from "@publira/ui-components/button";
import Link from "next/link";

import type { LayoutActionItem } from "./site-layout";

interface SiteLayoutActionsProps {
  primaryAction: LayoutActionItem;
  secondaryAction: LayoutActionItem;
}

const SiteLayoutActionButton = ({
  action,
  variant,
}: {
  action: LayoutActionItem;
  variant?: LinkButtonProps["variant"];
}) =>
  // `/logout` のような Route Handler は Link にすると hover / viewport の
  // prefetch だけで副作用が走るため、素の `<a>` のまま残す（#655 で解消予定）。
  action.hardNavigation ? (
    <LinkButton
      className={action.className}
      href={action.href}
      size="sm"
      variant={variant}
    >
      {action.label}
    </LinkButton>
  ) : (
    <LinkButton
      className={action.className}
      render={<Link href={action.href} />}
      size="sm"
      variant={variant}
    >
      {action.label}
    </LinkButton>
  );

export const SiteLayoutActions = ({
  primaryAction,
  secondaryAction,
}: SiteLayoutActionsProps) => (
  <div className="flex items-center gap-2">
    <SiteLayoutActionButton action={secondaryAction} variant="secondary" />
    <SiteLayoutActionButton action={primaryAction} />
  </div>
);
