"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { Select } from "@publira/ui-components/select";
import { useCallback, useState } from "react";
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

  const handleValueChange = useCallback((next: string) => {
    if (isSurfaceAvailabilityValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <FieldContent>
        <Select
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
