"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { Select } from "@publira/ui-components/select";
import type { SelectProps } from "@publira/ui-components/select";
import { useCallback, useId } from "react";

import { ClientMessage, useClientMessages } from "#components/client-message";
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
  onChange,
  value,
}: {
  onChange: (next: ReadingDirectionValue) => void;
  value: ReadingDirectionValue;
}) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback(
    (next: string) => {
      if (isReadingDirectionValue(next)) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.reading_direction" />
      </FieldLabel>
      <FieldContent>
        <ReadingDirectionSelect
          id={selectId}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="reading_direction" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.form.reading_direction_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};

/**
 * No upper bound: a series states it for episodes of every length, and one
 * shorter than the page named here is shown without spreads.
 */
export const SeriesSpreadStartField = ({
  defaultPage,
}: {
  defaultPage: number;
}) => (
  <Field>
    <FieldLabel required>
      <ClientMessage message="admin.series.form.spread_start" />
    </FieldLabel>
    <FieldContent>
      <Input
        defaultValue={defaultPage}
        min={1}
        name="spread_start_page"
        required
        step={1}
        type="number"
      />
      <FieldDescription>
        <ClientMessage message="admin.series.form.spread_start_description" />
      </FieldDescription>
    </FieldContent>
  </Field>
);
