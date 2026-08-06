"use client";

import { cn } from "@publira/utils";
import type { ComponentPropsWithoutRef, ReactNode } from "react";

type DivProps = ComponentPropsWithoutRef<"div">;

export type EmptyStateProps = DivProps & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
};

export const EmptyState = ({
  actions,
  className,
  description,
  icon,
  title,
  ...props
}: EmptyStateProps) => (
  <div
    {...props}
    className={cn(
      "grid gap-3 rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center",
      className
    )}
  >
    {icon ? <div className="mx-auto text-muted-foreground">{icon}</div> : null}
    <div className="grid gap-1">
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
    {actions ? <div className="mx-auto">{actions}</div> : null}
  </div>
);
