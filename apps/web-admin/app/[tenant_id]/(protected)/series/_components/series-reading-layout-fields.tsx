"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import { useCallback, useId, useState } from "react";
import type { ReactNode } from "react";

import { useClientMessages } from "#components/client-message";
import { isReadingDirectionValue } from "#lib/reading-layout";
import type { ReadingDirectionValue } from "#lib/reading-layout";

const ReadingDirectionSelect = (props: Omit<SelectProps, "items">) => {
  const t = useClientMessages();

  return (
    <Select
      {...props}
      items={[
        {
          label: t("admin.series.form.reading_direction_options.rtl"),
          value: "rtl",
        },
        {
          label: t("admin.series.form.reading_direction_options.ltr"),
          value: "ltr",
        },
      ]}
    />
  );
};

export const SeriesReadingDirectionField = ({
  description,
  initialValue,
  label,
}: {
  description: ReactNode;
  initialValue: ReadingDirectionValue;
  label: ReactNode;
}) => {
  const [value, setValue] = useState(initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isReadingDirectionValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <FieldContent>
        <ReadingDirectionSelect
          id={selectId}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="reading_direction" type="hidden" value={value} />
        {description}
      </FieldContent>
    </Field>
  );
};
