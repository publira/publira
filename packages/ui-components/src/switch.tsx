"use client";

import { Switch as BaseSwitch } from "@base-ui/react";
import { cn } from "@publira/utils";

export type SwitchProps = BaseSwitch.Root.Props & {
  thumbClassName?: string;
};

export const Switch = ({ className, thumbClassName, ...props }: SwitchProps) => (
  <BaseSwitch.Root
    {...props}
    className={cn(
      "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-input bg-muted transition-colors data-[checked]:border-primary data-[checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
  >
    <BaseSwitch.Thumb
      className={cn(
        "pointer-events-none block size-4 translate-x-0.5 rounded-full bg-background shadow-sm transition-transform data-[checked]:translate-x-4 data-[checked]:bg-primary-foreground",
        thumbClassName
      )}
    />
  </BaseSwitch.Root>
);