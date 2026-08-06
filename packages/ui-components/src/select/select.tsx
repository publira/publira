"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import { cn } from "@publira/utils";
import type { ReactNode } from "react";

interface SelectItem {
  label: ReactNode;
  value: string;
}

export type SelectProps = Omit<
  BaseSelect.Root.Props<string>,
  "children" | "items" | "multiple"
> & {
  className?: string;
  items: readonly SelectItem[];
  placeholder?: ReactNode;
};

export const Select = ({
  className,
  items,
  placeholder = "選択してください",
  ...props
}: SelectProps) => {
  const safeItems = items ?? [];

  return (
    <BaseSelect.Root {...props} items={safeItems}>
      <BaseSelect.Trigger
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground",
          className
        )}
      >
        <BaseSelect.Value placeholder={placeholder} />
        <BaseSelect.Icon className="text-muted-foreground">
          <svg
            aria-hidden="true"
            fill="none"
            height="16"
            viewBox="0 0 16 16"
            width="16"
          >
            <path
              d="m4 6 4 4 4-4"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner className="outline-none">
          <BaseSelect.Popup className="z-50 min-w-[var(--anchor-width)] overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
            <BaseSelect.List className="max-h-64 overflow-y-auto outline-none">
              {safeItems.map((item) => (
                <BaseSelect.Item
                  key={item.value}
                  value={item.value}
                  className="flex cursor-pointer items-center justify-between rounded-sm px-3 py-2 text-sm outline-none transition-colors data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                >
                  <BaseSelect.ItemText>{item.label}</BaseSelect.ItemText>
                  <BaseSelect.ItemIndicator className="text-primary">
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
