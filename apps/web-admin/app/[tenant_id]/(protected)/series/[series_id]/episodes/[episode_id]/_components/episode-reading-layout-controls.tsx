"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import type { ReactNode } from "react";
import { useCallback, useId, useState } from "react";

import { isReadingDirectionValue } from "#lib/reading-layout";
import type { ReadingDirectionValue } from "#lib/reading-layout";

interface SelectItem {
  label: string;
  value: string;
}

/** The empty value is the episode following its series. */
export const ReadingDirectionField = ({
  initialValue,
  items,
  label,
}: {
  initialValue: "" | ReadingDirectionValue;
  items: SelectItem[];
  label: ReactNode;
}) => {
  const [value, setValue] = useState(() => initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (next === "" || isReadingDirectionValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={items}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="reading_direction" type="hidden" value={value} />
      </FieldContent>
    </Field>
  );
};

type SpreadStartSource = "episode" | "series";

const isSpreadStartSource = (value: string): value is SpreadStartSource =>
  value === "episode" || value === "series";

/**
 * `pageField` is rendered after this field only while the episode sets its
 * own spread start.
 */
export const SpreadStartSourceField = ({
  description,
  initialValue,
  items,
  label,
  pageField,
}: {
  description: ReactNode;
  initialValue: SpreadStartSource;
  items: SelectItem[];
  label: ReactNode;
  pageField: ReactNode;
}) => {
  const [value, setValue] = useState(() => initialValue);
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isSpreadStartSource(next)) {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Field>
        <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
        <FieldContent>
          <Select
            id={selectId}
            items={items}
            onValueChange={handleValueChange}
            value={value}
          />
          <input name="spread_start_source" type="hidden" value={value} />
          {description}
        </FieldContent>
      </Field>
      {value === "episode" ? pageField : null}
    </>
  );
};
