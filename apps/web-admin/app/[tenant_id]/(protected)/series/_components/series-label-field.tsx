"use client";

import { toIntlLocale } from "@publira/i18n";
import * as Combobox from "@publira/ui-components/combobox";
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
  const items = useMemo<Combobox.Item[]>(
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
      <Combobox.Root items={items} onValueChange={setValue} value={value}>
        <Combobox.Input
          placeholder={t("admin.series.form.label_placeholder")}
        />
        <Combobox.Popup>
          <Combobox.Empty>
            <ClientMessage message="admin.series.form.label_empty" />
          </Combobox.Empty>
          <Combobox.Items />
        </Combobox.Popup>
      </Combobox.Root>

      <input name="label_id" type="hidden" value={value} />
    </>
  );
};
