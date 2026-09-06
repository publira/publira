"use client";

import {
  Radio as BaseRadio,
  RadioGroup as BaseRadioGroup,
} from "@base-ui/react";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";
import { useId } from "react";

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
}: RadioGroupProps) => {
  // Each option is named by its own label rather than by the surrounding
  // `Field`. A `Radio.Root` renders a `role="radio"` span, which a wrapping
  // `<label>` cannot name, and Base UI otherwise gives every radio in a Field
  // the field's own `aria-labelledby` — leaving a screen reader to announce
  // three identically named options.
  const itemIdPrefix = useId();

  return (
    <BaseRadioGroup {...props} className={cn("grid gap-2", className)}>
      {items.map((item) => {
        const labelId = `${itemIdPrefix}-${item.value}-label`;
        const descriptionId = `${itemIdPrefix}-${item.value}-description`;

        return (
          <label
            key={item.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/60 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50",
              itemClassName
            )}
          >
            <BaseRadio.Root
              aria-describedby={item.description ? descriptionId : undefined}
              aria-labelledby={labelId}
              className="relative mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border border-input bg-background transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[checked]:border-primary data-[checked]:bg-primary"
              disabled={item.disabled}
              value={item.value}
            >
              <BaseRadio.Indicator className="flex items-center justify-center text-primary-foreground">
                <span className="size-1.5 rounded-full bg-current" />
              </BaseRadio.Indicator>
            </BaseRadio.Root>

            <span className="grid gap-0.5">
              <span className="font-medium text-foreground" id={labelId}>
                {item.label}
              </span>
              {item.description ? (
                <span
                  className="text-xs text-muted-foreground"
                  id={descriptionId}
                >
                  {item.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </BaseRadioGroup>
  );
};
