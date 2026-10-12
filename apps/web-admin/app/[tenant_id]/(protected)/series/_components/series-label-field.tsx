"use client";

import { toIntlLocale } from "@publira/i18n";
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItems,
  ComboboxPopup,
} from "@publira/ui-components/combobox";
import type { ComboboxItem } from "@publira/ui-components/combobox";
import { useMemo, useState } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";

export interface LabelOption {
  id: string;
  name: string;
}

/**
 * The label the series is filed under, and the hidden field that posts it. The
 * caller places it in a `Field` and writes the label, the description, and
 * the reason the list could not be read there.
 */
export const SeriesLabelCombobox = ({
  initialValue,
  labels,
}: {
  /** The internal ID of the label the series is filed under, empty on create. */
  initialValue: string;
  labels: LabelOption[];
}) => {
  const locale = useAdminLocale();
  const t = useClientMessages();
  const [value, setValue] = useState(initialValue);
  const items = useMemo<ComboboxItem[]>(
    () =>
      labels
        .map((option) => ({ label: option.name, value: option.id }))
        .toSorted((a, b) =>
          a.label.localeCompare(b.label, toIntlLocale(locale))
        ),
    [labels, locale]
  );

  return (
    <>
      <Combobox items={items} onValueChange={setValue} value={value}>
        <ComboboxInput placeholder={t("admin.series.form.label_placeholder")} />
        <ComboboxPopup>
          <ComboboxEmpty>
            <ClientMessage message="admin.series.form.label_empty" />
          </ComboboxEmpty>
          <ComboboxItems />
        </ComboboxPopup>
      </Combobox>

      <input name="label_id" type="hidden" value={value} />
    </>
  );
};
