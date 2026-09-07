"use client";

import { Combobox as BaseCombobox } from "@base-ui/react/combobox";
import { CheckIcon } from "@publira/icons/check-icon";
import { cn } from "@publira/utils";
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";

export interface ComboboxItem {
  label: string;
  value: string;
}

/**
 * The id the caller gave the control, so the input slot carries it without the
 * call site having to repeat it on both the root and the input.
 */
export const ComboboxIdContext = createContext<string | undefined>(undefined);

export interface ComboboxProps {
  children: ReactNode;
  disabled?: boolean;
  id?: string;
  items: readonly ComboboxItem[];
  onValueChange: (nextValue: string) => void;
  value: string;
}

/**
 * A searchable single-select, implemented on top of
 * [Base UI Combobox](https://base-ui.com/react/components/combobox).
 *
 * Composed rather than prop-driven: the input and the empty popup are elements
 * the caller writes, so the placeholder and the "nothing matches" wording sit
 * where they are rendered instead of arriving as props named after them.
 *
 * ```tsx
 * <Combobox items={items} onValueChange={setLabel} value={label}>
 *   <ComboboxInput placeholder="Search labels" />
 *   <ComboboxPopup>
 *     <ComboboxEmpty>No matching items.</ComboboxEmpty>
 *     <ComboboxItems />
 *   </ComboboxPopup>
 * </Combobox>
 * ```
 */
export const Combobox = ({
  children,
  disabled,
  id,
  items,
  onValueChange,
  value,
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
      id={id}
      items={items}
      itemToStringLabel={itemToStringLabel}
      onValueChange={handleValueChange}
      value={selectedItem}
    >
      <ComboboxIdContext value={id}>{children}</ComboboxIdContext>
    </BaseCombobox.Root>
  );
};

export const ComboboxInput = ({
  "aria-label": ariaLabel,
  className,
  placeholder,
}: {
  /** Names the control where no `FieldLabel` points at it. */
  "aria-label"?: string;
  className?: string;
  placeholder?: string;
}) => {
  const id = useContext(ComboboxIdContext);

  return (
    <BaseCombobox.Input
      aria-label={ariaLabel}
      className={cn(
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      id={id}
      placeholder={placeholder}
    />
  );
};

/**
 * The popup both comboboxes drop open. Holds `ComboboxEmpty` and
 * `ComboboxItems`.
 */
export const ComboboxPopup = ({ children }: { children: ReactNode }) => (
  <BaseCombobox.Portal>
    <BaseCombobox.Positioner className="z-50 outline-none" sideOffset={4}>
      <BaseCombobox.Popup className="max-h-72 w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-md border border-border bg-popover py-1 text-popover-foreground shadow-md">
        {children}
      </BaseCombobox.Popup>
    </BaseCombobox.Positioner>
  </BaseCombobox.Portal>
);

/** Shown in the popup when nothing matches what was typed. */
export const ComboboxEmpty = ({ children }: { children: ReactNode }) => (
  <BaseCombobox.Empty className="px-3 py-2 text-sm text-muted-foreground">
    {children}
  </BaseCombobox.Empty>
);

/** The filtered options. Each one is labelled by the item it renders. */
export const ComboboxItems = () => (
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
);
