"use client";

import { Checkbox as BaseCheckbox } from "@base-ui/react/checkbox";
import { cn } from "@publira/utils";
import * as React from "react";

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
      <svg
        aria-hidden="true"
        fill="none"
        height="8"
        viewBox="0 0 10 8"
        width="10"
      >
        <path
          d="M1 3.5 3.5 6 9 1"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />
      </svg>
    </BaseCheckbox.Indicator>
  </BaseCheckbox.Root>
);
