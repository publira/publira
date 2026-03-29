"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { CheckIcon } from "@publira/icons/check-icon";
import { cn } from "@publira/utils";
import { useCallback, useMemo } from "react";

export interface ComboboxItem {
  label: string;
  value: string;
}

export interface ComboboxProps {
  items: readonly ComboboxItem[];
  value: string;
  onValueChange: (nextValue: string) => void;
  id?: string;
  placeholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

export const Combobox = ({
  items,
  value,
  onValueChange,
  id,
  placeholder = "検索",
  emptyMessage = "一致する項目が見つかりません。",
  disabled,
  className,
}: ComboboxProps) => {
  const itemToStringLabel = useCallback((item: ComboboxItem) => item.label, []);
  const selectedItem = useMemo(
    () => items.find((item) => item.value === value) ?? null,
    [items, value]
  );

  const handleValueChange = useCallback(
    (nextValue: ComboboxItem | ComboboxItem[] | null) => {
      if (!nextValue || Array.isArray(nextValue)) {
        onValueChange("");
        return;
      }

      onValueChange(nextValue.value);
    },
    [onValueChange]
  );

  return (
    <BaseCombobox.Root
      disabled={disabled}
      items={items}
      itemToStringLabel={itemToStringLabel}
      onValueChange={handleValueChange}
      value={selectedItem}
    >
      <BaseCombobox.Input
        className={cn(
          "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        id={id}
        placeholder={placeholder}
      />

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-50 outline-none" sideOffset={4}>
          <BaseCombobox.Popup className="max-h-72 w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
            <BaseCombobox.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: ComboboxItem) => (
                <BaseCombobox.Item
                  className="grid cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 px-3 py-2 text-sm outline-none data-highlighted:bg-muted"
                  key={item.value}
                  value={item}
                >
                  <BaseCombobox.ItemIndicator className="col-start-1 text-primary">
                    <CheckIcon className="h-3 w-3" />
                  </BaseCombobox.ItemIndicator>
                  <span className="col-start-2">{item.label}</span>
                </BaseCombobox.Item>
              )}
            </BaseCombobox.List>
          </BaseCombobox.Popup>
        </BaseCombobox.Positioner>
      </BaseCombobox.Portal>
    </BaseCombobox.Root>
  );
};
