"use client";

import * as MultiCombobox from "@publira/ui-components/multi-combobox";
import { useCallback, useMemo, useState } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";

interface ActorFilterComboboxProps {
  defaultValue: string;
  items: MultiCombobox.Item[];
}

export const ActorFilterCombobox = ({
  defaultValue,
  items,
}: ActorFilterComboboxProps) => {
  const t = useClientMessages();
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
      <MultiCombobox.Root
        items={normalizedItems}
        onValueChange={handleValueChange}
        value={selectedValues}
      >
        <MultiCombobox.InputGroup>
          <MultiCombobox.Chips>
            {(selected) => (
              <>
                {selected.map((item) => (
                  <MultiCombobox.Chip item={item} key={item.value}>
                    {item.label}
                    <MultiCombobox.ChipRemove
                      aria-label={t("admin.audit.filter.actor_remove")}
                    />
                  </MultiCombobox.Chip>
                ))}
                <MultiCombobox.Input
                  placeholder={
                    selected.length > 0
                      ? ""
                      : t("admin.audit.filter.actor_placeholder")
                  }
                />
              </>
            )}
          </MultiCombobox.Chips>
        </MultiCombobox.InputGroup>
        <MultiCombobox.Popup>
          <MultiCombobox.Empty>
            <ClientMessage message="admin.audit.filter.actor_empty" />
          </MultiCombobox.Empty>
          <MultiCombobox.Items />
        </MultiCombobox.Popup>
      </MultiCombobox.Root>
      <input name="actor" type="hidden" value={selectedValues[0] ?? ""} />
    </>
  );
};
