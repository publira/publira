"use client";

import {
  ComboboxEmpty,
  ComboboxItems,
  ComboboxPopup,
  MultiCombobox,
  MultiComboboxChip,
  MultiComboboxChipRemove,
  MultiComboboxChips,
  MultiComboboxInput,
  MultiComboboxInputGroup,
} from "@publira/ui-components/combobox";
import type { MultiComboboxItem } from "@publira/ui-components/combobox";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense, useCallback, useMemo, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import { ClientMessage } from "#components/client-message";

interface ActorFilterComboboxProps {
  defaultValue: string;
  items: MultiComboboxItem[];
}

export const ActorFilterCombobox = ({
  defaultValue,
  items,
}: ActorFilterComboboxProps) => {
  const t = useAdminMessages();
  const [selectedValues, setSelectedValues] = useState<string[]>(
    defaultValue ? [defaultValue] : []
  );

  const normalizedItems = useMemo(() => {
    if (!defaultValue || items.some((item) => item.value === defaultValue)) {
      return items;
    }

    return [
      {
        label: defaultValue,
        value: defaultValue,
      },
      ...items,
    ];
  }, [defaultValue, items]);

  const handleValueChange = useCallback((nextValues: string[]) => {
    setSelectedValues(nextValues.slice(0, 1));
  }, []);

  return (
    <>
      <MultiCombobox
        items={normalizedItems}
        onValueChange={handleValueChange}
        value={selectedValues}
      >
        <MultiComboboxInputGroup>
          <MultiComboboxChips>
            {(selected) => (
              <>
                {selected.map((item) => (
                  <MultiComboboxChip item={item} key={item.value}>
                    {item.label}
                    <MultiComboboxChipRemove
                      aria-label={t("admin.audit.filter.actor_remove")}
                    />
                  </MultiComboboxChip>
                ))}
                <MultiComboboxInput
                  placeholder={
                    selected.length > 0
                      ? ""
                      : t("admin.audit.filter.actor_placeholder")
                  }
                />
              </>
            )}
          </MultiComboboxChips>
        </MultiComboboxInputGroup>
        <ComboboxPopup>
          <ComboboxEmpty>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.audit.filter.actor_empty" />
            </Suspense>
          </ComboboxEmpty>
          <ComboboxItems />
        </ComboboxPopup>
      </MultiCombobox>
      <input name="actor" type="hidden" value={selectedValues[0] ?? ""} />
    </>
  );
};
