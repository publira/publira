"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import type { LinkButtonProps } from "@publira/ui-components/button";
import Link from "next/link";

import type { LayoutActionItem } from "./site-layout";

interface SiteLayoutActionsProps {
  logoutAction?: (formData: FormData) => void | Promise<void>;
  /** Label of the sign-out button, already resolved by the caller. */
  logoutLabel: string;
  primaryAction: LayoutActionItem;
  secondaryAction?: LayoutActionItem;
}

const SiteLayoutActionButton = ({
  action,
  variant,
}: {
  action: LayoutActionItem;
  variant?: LinkButtonProps["variant"];
}) => (
  <LinkButton
    className={action.className}
    render={<Link href={action.href} />}
    size="sm"
    variant={variant}
  >
    {action.label}
  </LinkButton>
);

const SiteLayoutSecondaryAction = ({
  logoutAction,
  logoutLabel,
  secondaryAction,
}: Pick<
  SiteLayoutActionsProps,
  "logoutAction" | "logoutLabel" | "secondaryAction"
>) => {
  if (logoutAction) {
    return (
      <form action={logoutAction}>
        <Button size="sm" type="submit" variant="secondary">
          {logoutLabel}
        </Button>
      </form>
    );
  }

  if (secondaryAction) {
    return (
      <SiteLayoutActionButton action={secondaryAction} variant="secondary" />
    );
  }

  return null;
};

export const SiteLayoutActions = ({
  logoutAction,
  logoutLabel,
  primaryAction,
  secondaryAction,
}: SiteLayoutActionsProps) => (
  <div className="flex items-center gap-2">
    <SiteLayoutSecondaryAction
      logoutAction={logoutAction}
      logoutLabel={logoutLabel}
      secondaryAction={secondaryAction}
    />
    <SiteLayoutActionButton action={primaryAction} />
  </div>
);
