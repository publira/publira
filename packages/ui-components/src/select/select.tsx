"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon } from "@publira/icons/check-icon";
import { ChevronDownIcon } from "@publira/icons/chevron-down-icon";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

import { FieldPopupTrigger } from "../field/field";
import { FLOATING_TRANSITION } from "../motion";

interface SelectItem {
  label: ReactNode;
  value: string;
}

export type SelectProps = Omit<
  BaseSelect.Root.Props<string>,
  "children" | "items" | "multiple" | "onValueChange"
> & {
  className?: string;
  items: readonly SelectItem[];
  onValueChange?: (
    value: string,
    eventDetails: BaseSelect.Root.ChangeEventDetails
  ) => void;
  placeholder?: ReactNode;
};

export const Select = ({
  className,
  id,
  items,
  onValueChange,
  placeholder,
  ...props
}: SelectProps) => {
  const safeItems = items ?? [];

  // Base UI reports `null` only for an item whose value is `null`, which
  // `items` cannot hold. Built only when a caller passes a handler: a Server
  // Component renders this without the directive and cannot hand Base UI a
  // function.
  const handleValueChange = onValueChange
    ? (
        value: string | null,
        eventDetails: BaseSelect.Root.ChangeEventDetails
      ) => {
        if (value !== null) {
          onValueChange(value, eventDetails);
        }
      }
    : undefined;

  return (
    <BaseSelect.Root
      {...props}
      id={id}
      items={safeItems}
      onValueChange={handleValueChange}
    >
      <BaseSelect.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-control border border-input bg-card px-3 py-2 text-sm text-foreground transition-colors duration-state ease-state focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
          className
        )}
        id={id}
        render={<FieldPopupTrigger />}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="text-muted-foreground">
          <ChevronDownIcon className="size-4" />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner className="outline-none">
          <BaseSelect.Popup
            className={cn(
              "z-50 min-w-[var(--anchor-width)] origin-[var(--transform-origin)] overflow-hidden rounded-surface border border-border bg-popover p-1 text-popover-foreground shadow-floating outline-none",
              FLOATING_TRANSITION
            )}
          >
            <BaseSelect.List className="max-h-64 overflow-y-auto outline-none">
              {safeItems.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className="flex cursor-pointer items-center justify-between rounded-control px-3 py-2 text-sm transition-colors duration-state ease-state outline-none data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                >
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-primary">
                    <CheckIcon className="size-3" />
                  </BaseSelect.ItemIndicator>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
};
