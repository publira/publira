"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
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
import { useCallback, useContext, useMemo, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

interface ActorFilterComboboxProps {
  defaultValue: string;
  items: MultiComboboxItem[];
}

export const ActorFilterCombobox = ({
  defaultValue,
  items,
}: ActorFilterComboboxProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
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
                      aria-label={getMessage(
                        messages,
                        "admin.audit.filter.actor_remove"
                      )}
                    />
                  </MultiComboboxChip>
                ))}
                <MultiComboboxInput
                  placeholder={
                    selected.length > 0
                      ? ""
                      : getMessage(
                          messages,
                          "admin.audit.filter.actor_placeholder"
                        )
                  }
                />
              </>
            )}
          </MultiComboboxChips>
        </MultiComboboxInputGroup>
        <ComboboxPopup>
          <ComboboxEmpty>
            {getMessage(messages, "admin.audit.filter.actor_empty")}
          </ComboboxEmpty>
          <ComboboxItems />
        </ComboboxPopup>
      </MultiCombobox>
      <input name="actor" type="hidden" value={selectedValues[0] ?? ""} />
    </>
  );
};
