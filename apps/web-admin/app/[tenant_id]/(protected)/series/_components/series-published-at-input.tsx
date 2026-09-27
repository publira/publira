"use client";

import { Input } from "@publira/ui-components/input";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@publira/utils";
import { useState } from "react";

/**
 * The publication date as a wall clock in the zone the form was rendered in,
 * and the instant it names in the `published_at` field the Action reads. The
 * instant is resolved here rather than by the Action, so it cannot reinterpret
 * the same wall clock after the tenant zone changes in another tab.
 */
export const SeriesPublishedAtInput = ({
  initialValue,
  timeZone,
}: {
  /** The stored instant, empty while the series has no publication date. */
  initialValue: string;
  timeZone: string;
}) => {
  const [localValue, setLocalValue] = useState(() =>
    toDateTimeLocalValue(initialValue, timeZone)
  );

  return (
    <>
      <input
        name="published_at"
        type="hidden"
        value={fromDateTimeLocalValue(localValue, timeZone)}
      />
      <Input
        name="published_at_local"
        onChange={(event) => setLocalValue(event.currentTarget.value)}
        type="datetime-local"
        value={localValue}
      />
    </>
  );
};
