"use client";

import { Input } from "@publira/ui-components/input";
import { fromDateTimeLocalValue, toDateTimeLocalValue } from "@publira/utils";
import { useState } from "react";

interface InstantInputProps {
  /** The stored instant, empty while there is none. */
  initialValue?: string;
  /** The field the Action reads the instant from; the wall clock is `<name>_local`. */
  name: string;
  /** Whether the wall clock has to be filled in before the form submits. */
  required?: boolean;
  step?: number;
  timeZone: string;
}

/**
 * A wall clock in the zone the form was rendered in, and the instant it names
 * in the `name` field the Action reads. The instant is resolved here rather
 * than by the Action, so it cannot reinterpret the same wall clock after the
 * tenant zone changes in another tab.
 *
 * A wall clock left as it opened posts the stored instant itself rather than
 * the one the wall clock names: `datetime-local` holds minutes, so resolving
 * an untouched field again would drop the seconds of an instant the API wrote
 * and move a value the operator never edited.
 */
export const InstantInput = ({
  initialValue = "",
  name,
  required,
  step,
  timeZone,
}: InstantInputProps) => {
  const initialLocalValue = toDateTimeLocalValue(initialValue, timeZone);
  const [localValue, setLocalValue] = useState(initialLocalValue);

  return (
    <>
      <input
        name={name}
        type="hidden"
        value={
          localValue === initialLocalValue
            ? initialValue
            : fromDateTimeLocalValue(localValue, timeZone)
        }
      />
      <Input
        name={`${name}_local`}
        onChange={(event) => setLocalValue(event.currentTarget.value)}
        required={required}
        step={step}
        type="datetime-local"
        value={localValue}
      />
    </>
  );
};
