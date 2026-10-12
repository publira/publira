"use client";

import { Select } from "@publira/ui-components/select";
import { useCallback, useState } from "react";

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

/**
 * Where the series is offered, and the hidden field that posts it. The caller
 * places it in a `Field` and writes the label and the description there.
 */
export const SeriesAvailabilitySelect = ({
  initialValue,
}: {
  initialValue: SurfaceAvailabilityValue;
}) => {
  const [value, setValue] = useState(initialValue);

  const handleValueChange = useCallback((next: string) => {
    if (isSurfaceAvailabilityValue(next)) {
      setValue(next);
    }
  }, []);

  return (
    <>
      <Select
        items={SERIES_AVAILABILITY_ITEMS}
        onValueChange={handleValueChange}
        value={value}
      />
      <input name="availability" type="hidden" value={value} />
    </>
  );
};
