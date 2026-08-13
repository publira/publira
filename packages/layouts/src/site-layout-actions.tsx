"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import type { LinkButtonProps } from "@publira/ui-components/button";
import Link from "next/link";

import type { LayoutActionItem } from "./site-layout";

interface SiteLayoutActionsProps {
  logoutAction?: (formData: FormData) => void | Promise<void>;
  primaryAction: LayoutActionItem;
  secondaryAction?: LayoutActionItem;
}

const LOGOUT_LABEL = "Logout";

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
  secondaryAction,
}: Pick<SiteLayoutActionsProps, "logoutAction" | "secondaryAction">) => {
  if (logoutAction) {
    return (
      <form action={logoutAction}>
        <Button size="sm" type="submit" variant="secondary">
          {LOGOUT_LABEL}
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
  primaryAction,
  secondaryAction,
}: SiteLayoutActionsProps) => (
  <div className="flex items-center gap-2">
    <SiteLayoutSecondaryAction
      logoutAction={logoutAction}
      secondaryAction={secondaryAction}
    />
    <SiteLayoutActionButton action={primaryAction} />
  </div>
);
