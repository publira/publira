"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { CheckIcon } from "@publira/icons/check-icon";
import { CloseIcon } from "@publira/icons/close-icon";
import { cn } from "@publira/utils";
import { useCallback, useMemo } from "react";

export interface MultiComboboxItem {
  label: string;
  value: string;
}

export interface MultiComboboxProps {
  items: readonly MultiComboboxItem[];
  value: readonly string[];
  onValueChange: (nextValue: string[]) => void;
  id?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  disabled?: boolean;
  className?: string;
}

export const MultiCombobox = ({
  items,
  value,
  onValueChange,
  id,
  searchPlaceholder = "検索",
  emptyMessage = "一致する項目が見つかりません。",
  disabled,
  className,
}: MultiComboboxProps) => {
  const itemToStringLabel = useCallback(
    (item: MultiComboboxItem) => item.label,
    []
  );
  const itemMap = useMemo(
    () => new Map(items.map((item) => [item.value, item])),
    [items]
  );

  const selectedItems = useMemo(
    () => value.map((valueItem) => itemMap.get(valueItem)).filter(Boolean),
    [itemMap, value]
  ) as MultiComboboxItem[];

  const handleValueChange = useCallback(
    (nextValue: MultiComboboxItem[] | MultiComboboxItem | null) => {
      let nextItems: MultiComboboxItem[] = [];
      if (Array.isArray(nextValue)) {
        nextItems = nextValue;
      } else if (nextValue) {
        nextItems = [nextValue];
      }

      onValueChange(nextItems.map((item) => item.value));
    },
    [onValueChange]
  );

  return (
    <BaseCombobox.Root
      disabled={disabled}
      items={items}
      itemToStringLabel={itemToStringLabel}
      multiple
      onValueChange={handleValueChange}
      value={selectedItems}
    >
      <BaseCombobox.InputGroup
        className={cn(
          "relative flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 shadow-xs focus-within:outline-none focus-within:ring-2 focus-within:ring-ring",
          className
        )}
      >
        <BaseCombobox.Chips className="flex w-full flex-wrap items-center gap-1">
          <BaseCombobox.Value>
            {(selected: MultiComboboxItem[]) => (
              <>
                {selected.map((item) => (
                  <BaseCombobox.Chip
                    aria-label={item.label}
                    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
                    key={item.value}
                  >
                    {item.label}
                    <BaseCombobox.ChipRemove
                      aria-label="削除"
                      className="rounded p-0.5 hover:bg-background"
                    >
                      <CloseIcon className="h-3 w-3" />
                    </BaseCombobox.ChipRemove>
                  </BaseCombobox.Chip>
                ))}
                <BaseCombobox.Input
                  className="h-8 min-w-24 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
                  id={id}
                  placeholder={selected.length > 0 ? "" : searchPlaceholder}
                />
              </>
            )}
          </BaseCombobox.Value>
        </BaseCombobox.Chips>
      </BaseCombobox.InputGroup>

      <BaseCombobox.Portal>
        <BaseCombobox.Positioner className="z-50 outline-none" sideOffset={4}>
          <BaseCombobox.Popup className="max-h-72 w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
            <BaseCombobox.Empty className="px-3 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </BaseCombobox.Empty>
            <BaseCombobox.List>
              {(item: MultiComboboxItem) => (
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
