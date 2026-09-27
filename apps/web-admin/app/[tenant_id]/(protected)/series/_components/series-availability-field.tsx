"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useId, useState } from "react";
import type { ReactNode } from "react";

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
  description,
  initialValue,
  label,
}: {
  description: ReactNode;
  initialValue: SurfaceAvailabilityValue;
  label: ReactNode;
}) => {
  const [value, setValue] = useState(initialValue);
  // `Select` renders a trigger rather than a Field control, so the label needs
  // an id to point at.
  const selectId = useId();

  const handleValueChange = useCallback((next: string) => {
    if (isSurfaceAvailabilityValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <Field>
      <FieldLabel htmlFor={selectId}>{label}</FieldLabel>
      <FieldContent>
        <Select
          id={selectId}
          items={SERIES_AVAILABILITY_ITEMS}
          onValueChange={handleValueChange}
          value={value}
        />
        <input name="availability" type="hidden" value={value} />
        {description}
      </FieldContent>
    </Field>
  );
};
