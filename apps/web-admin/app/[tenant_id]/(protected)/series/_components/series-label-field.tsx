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
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";

import { useAdminLocale } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";

export interface LabelOption {
  id: string;
  name: string;
}

export const SeriesLabelField = ({
  description,
  initialValue,
  label,
  labels,
  labelsErrorMessage,
}: {
  description: ReactNode;
  /** The internal ID of the label the series is filed under, empty on create. */
  initialValue: string;
  label: ReactNode;
  labels: LabelOption[];
  labelsErrorMessage?: string;
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
    <Field>
      <FieldLabel required>{label}</FieldLabel>
      <FieldContent>
        {labelsErrorMessage ? (
          <FormMessage variant="destructive">{labelsErrorMessage}</FormMessage>
        ) : null}

        <Combobox items={items} onValueChange={setValue} value={value}>
          <ComboboxInput
            placeholder={t("admin.series.form.label_placeholder")}
          />
          <ComboboxPopup>
            <ComboboxEmpty>
              <ClientMessage message="admin.series.form.label_empty" />
            </ComboboxEmpty>
            <ComboboxItems />
          </ComboboxPopup>
        </Combobox>

        <input name="label_id" type="hidden" value={value} />

        {description}
      </FieldContent>
    </Field>
  );
};
