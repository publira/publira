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
  withIndicator,
  ...props
}: StatusChipProps) => {
  // The outline badge is a dot and its text already, so it carries its own.
  const showIndicator = withIndicator ?? variant !== "outline";

  return (
    <Badge {...props} className={className} tone={status} variant={variant}>
      {showIndicator ? (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-current"
        />
      ) : null}
      <span className="min-w-0">{children}</span>
    </Badge>
  );
};
