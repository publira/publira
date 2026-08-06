"use client";

import {
  Radio as BaseRadio,
  RadioGroup as BaseRadioGroup,
} from "@base-ui/react";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

interface RadioGroupItem {
  description?: ReactNode;
  disabled?: boolean;
  label: ReactNode;
  value: string;
}

export type RadioGroupProps = Omit<BaseRadioGroup.Props<string>, "children"> & {
  className?: string;
  itemClassName?: string;
  items: readonly RadioGroupItem[];
};

export const RadioGroup = ({
  className,
  itemClassName,
  items,
  ...props
}: RadioGroupProps) => (
  <BaseRadioGroup {...props} className={cn("grid gap-2", className)}>
    {items.map((item) => (
      <label
        key={item.value}
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
          itemClassName
        )}
      >
        <BaseRadio.Root
          className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors data-[checked]:border-primary data-[checked]:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          disabled={item.disabled}
          value={item.value}
        >
          <BaseRadio.Indicator className="flex items-center justify-center text-primary-foreground">
            <span className="size-1.5 rounded-full bg-current" />
          </BaseRadio.Indicator>
        </BaseRadio.Root>

        <span className="grid gap-0.5">
          <span className="font-medium text-foreground">{item.label}</span>
          {item.description ? (
            <span className="text-xs text-muted-foreground">
              {item.description}
            </span>
          ) : null}
        </span>
      </label>
    ))}
  </BaseRadioGroup>
);
