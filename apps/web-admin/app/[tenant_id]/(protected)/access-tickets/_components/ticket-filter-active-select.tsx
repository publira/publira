"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useId } from "react";

interface TicketFilterActiveSelectProps {
  defaultValue: string;
}

export const TicketFilterActiveSelect = ({
  defaultValue,
}: TicketFilterActiveSelectProps) => {
  // Native <select> is not a Field control, so the label needs an id to point at.
  const activeSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={activeSelectId}>状態</FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
          defaultValue={defaultValue}
          id={activeSelectId}
          name="active"
        >
          <option value="">すべて</option>
          <option value="1">有効のみ</option>
        </select>
      </FieldContent>
    </Field>
  );
};
