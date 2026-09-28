"use client";

import { Input } from "@publira/ui-components/input";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@publira/utils";
import { useState } from "react";

interface InstantInputProps {
  /** The stored instant, empty while there is none. */
  initialValue?: string;
  /** The field the Action reads the instant from; the wall clock is `<name>_local`. */
  name: string;
  step?: number;
  timeZone: string;
}

/**
 * A wall clock in the zone the form was rendered in, and the instant it names
 * in the `name` field the Action reads. The instant is resolved here rather
 * than by the Action, so it cannot reinterpret the same wall clock after the
 * tenant zone changes in another tab.
 */
export const InstantInput = ({
  initialValue = "",
  name,
  step,
  timeZone,
}: InstantInputProps) => {
  const [localValue, setLocalValue] = useState(() =>
    toDateTimeLocalValue(initialValue, timeZone)
  );

  return (
    <>
      <input
        name={name}
        type="hidden"
        value={fromDateTimeLocalValue(localValue, timeZone)}
      />
      <Input
        name={`${name}_local`}
        onChange={(event) => setLocalValue(event.currentTarget.value)}
        step={step}
        type="datetime-local"
        value={localValue}
      />
    </>
  );
};
