"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { CheckIcon } from "@publira/icons/check-icon";
import { cn } from "@publira/utils";

export type CheckboxProps = BaseCheckbox.Root.Props;

export const Checkbox = ({ className, ...props }: CheckboxProps) => (
  <BaseCheckbox.Root
    {...props}
    className={cn(
      "relative inline-flex size-4 shrink-0 cursor-pointer items-center justify-center rounded border border-input bg-background transition-colors data-[checked]:border-primary data-[checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
  >
    <BaseCheckbox.Indicator className="flex items-center justify-center text-primary-foreground">
      <CheckIcon className="size-3" />
    </BaseCheckbox.Indicator>
  </BaseCheckbox.Root>
);
