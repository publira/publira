"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { CloseIcon } from "@publira/icons/close-icon";
import { cn } from "@publira/utils";
import { useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { ComboboxIdContext } from "./combobox";

export interface MultiComboboxItem {
  label: string;
  value: string;
}

export interface MultiComboboxProps {
  children: ReactNode;
  disabled?: boolean;
  id?: string;
  items: readonly MultiComboboxItem[];
  onValueChange: (nextValue: string[]) => void;
  value: readonly string[];
}

/**
 * A searchable multi-select whose selection is shown as removable chips,
 * implemented on top of
 * [Base UI Combobox](https://base-ui.com/react/components/combobox).
 *
 * Composed rather than prop-driven: a chip's remove button is an element the
 * caller writes, so its accessible name is an ordinary `aria-label` on that
 * button instead of a `removeLabel` prop naming an element the call site never
 * sees. The chips are a render function because each one is built from a
 * selected item.
 *
 * ```tsx
 * <MultiCombobox items={items} onValueChange={setCreators} value={creators}>
 *   <MultiComboboxInputGroup>
 *     <MultiComboboxChips>
 *       {(selected) => (
 *         <>
 *           {selected.map((item) => (
 *             <MultiComboboxChip item={item} key={item.value}>
 *               {item.label}
 *               <MultiComboboxChipRemove aria-label="Remove" />
 *             </MultiComboboxChip>
 *           ))}
 *           <MultiComboboxInput
 *             placeholder={selected.length > 0 ? "" : "Search creators"}
 *           />
 *         </>
 *       )}
 *     </MultiComboboxChips>
 *   </MultiComboboxInputGroup>
 *   <ComboboxPopup>
 *     <ComboboxEmpty>No matching items.</ComboboxEmpty>
 *     <ComboboxItems />
 *   </ComboboxPopup>
 * </MultiCombobox>
 * ```
 */
export const MultiCombobox = ({
  children,
  disabled,
  id,
  items,
  onValueChange,
  value,
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
    () =>
      value.flatMap((valueItem) => {
        const item = itemMap.get(valueItem);
        return item ? [item] : [];
      }),
    [itemMap, value]
  );

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
      id={id}
      items={items}
      itemToStringLabel={itemToStringLabel}
      multiple
      onValueChange={handleValueChange}
      value={selectedItems}
    >
      <ComboboxIdContext value={id}>{children}</ComboboxIdContext>
    </BaseCombobox.Root>
  );
};

/** The bordered box that holds the chips and the search input. */
export const MultiComboboxInputGroup = ({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) => (
  <BaseCombobox.InputGroup
    className={cn(
      "relative flex min-h-10 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-background px-1.5 py-1 shadow-xs focus-within:ring-2 focus-within:ring-ring focus-within:outline-none",
      className
    )}
  >
    {children}
  </BaseCombobox.InputGroup>
);

/**
 * The selected items, as a render function: each call gets the current
 * selection so the caller can build one chip per item and word the input's
 * placeholder for an empty selection.
 */
export const MultiComboboxChips = ({
  children,
}: {
  children: (selected: MultiComboboxItem[]) => ReactNode;
}) => (
  <BaseCombobox.Chips className="flex w-full flex-wrap items-center gap-1">
    <BaseCombobox.Value>{children}</BaseCombobox.Value>
  </BaseCombobox.Chips>
);

export const MultiComboboxChip = ({
  children,
  item,
}: {
  children: ReactNode;
  item: MultiComboboxItem;
}) => (
  <BaseCombobox.Chip
    aria-label={item.label}
    className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"
  >
    {children}
  </BaseCombobox.Chip>
);

export const MultiComboboxChipRemove = ({
  "aria-label": ariaLabel,
}: {
  /** Names the button that drops one selected chip. */
  "aria-label": string;
}) => (
  <BaseCombobox.ChipRemove
    aria-label={ariaLabel}
    className="rounded p-0.5 hover:bg-background"
  >
    <CloseIcon className="h-3 w-3" />
  </BaseCombobox.ChipRemove>
);

export const MultiComboboxInput = ({
  "aria-label": ariaLabel,
  placeholder,
}: {
  /** Names the control where no `FieldLabel` points at it. */
  "aria-label"?: string;
  placeholder?: string;
}) => {
  const id = useContext(ComboboxIdContext);

  return (
    <BaseCombobox.Input
      aria-label={ariaLabel}
      className="h-8 min-w-24 flex-1 border-0 bg-transparent px-2 text-sm outline-none"
      id={id}
      placeholder={placeholder}
    />
  );
};
