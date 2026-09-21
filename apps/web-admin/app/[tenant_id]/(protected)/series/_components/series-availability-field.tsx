"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useId } from "react";

import { ClientMessage } from "#components/client-message";
import { isSurfaceAvailabilityValue } from "#lib/surface-availability";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

const SERIES_AVAILABILITY_ITEMS = [
  {
    label: <ClientMessage message="admin.series.availability.all" />,
    value: "all",
  },
  {
    label: <ClientMessage message="admin.series.availability.web" />,
    value: "web",
  },
  {
    label: <ClientMessage message="admin.series.availability.app" />,
    value: "app",
  },
];

export const SeriesAvailabilityField = ({
  onChange,
  value,
}: {
  onChange: (next: SurfaceAvailabilityValue) => void;
  value: SurfaceAvailabilityValue;
}) => {
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback(
    (next: string) => {
      if (isSurfaceAvailabilityValue(next)) {
        onChange(next);
      }
    },
    [onChange]
  );

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>
        <ClientMessage message="admin.series.form.availability" />
      </FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={SERIES_AVAILABILITY_ITEMS}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="availability" type="hidden" value={value} />
        <FieldDescription>
          <ClientMessage message="admin.series.form.availability_description" />
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
