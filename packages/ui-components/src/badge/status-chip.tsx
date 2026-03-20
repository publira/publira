"use client";

import { Badge } from "./badge";
import type { BadgeProps, BadgeTone } from "./badge";

export type StatusChipProps = Omit<BadgeProps, "tone"> & {
  status?: BadgeTone;
  withIndicator?: boolean;
};

export const StatusChip = ({
  children,
  className,
  status = "muted",
  variant = "soft",
  withIndicator = true,
  ...props
}: StatusChipProps) => (
  <Badge {...props} className={className} tone={status} variant={variant}>
    {withIndicator ? (
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full bg-current"
      />
    ) : null}
    <span className="min-w-0">{children}</span>
  </Badge>
);
