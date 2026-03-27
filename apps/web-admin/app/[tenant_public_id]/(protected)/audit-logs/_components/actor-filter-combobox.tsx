"use client";

import { MultiCombobox } from "@publira/ui-components/combobox";
import type { MultiComboboxItem } from "@publira/ui-components/combobox";
import { useCallback, useMemo, useState } from "react";

interface ActorFilterComboboxProps {
  defaultValue: string;
  items: MultiComboboxItem[];
}

export const ActorFilterCombobox = ({
  defaultValue,
  items,
}: ActorFilterComboboxProps) => {
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
        emptyMessage="一致する操作者が見つかりません。"
        id="actor"
        items={normalizedItems}
        onValueChange={handleValueChange}
        searchPlaceholder="操作者を検索"
        value={selectedValues}
      />
      <input name="actor" type="hidden" value={selectedValues[0] ?? ""} />
    </>
  );
};
