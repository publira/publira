"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useId } from "react";

interface AuditActionOption {
  label: string;
  value: string;
}

interface AuditActionSelectProps {
  defaultValue: string;
  options: readonly AuditActionOption[];
}

export const AuditActionSelect = ({
  defaultValue,
  options,
}: AuditActionSelectProps) => {
  // Native <select> is not a Field control, so the label needs an id to point at.
  const actionSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={actionSelectId}>アクション</FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
          defaultValue={defaultValue}
          id={actionSelectId}
          name="action"
        >
          {options.map((option) => (
            <option key={option.value || "all"} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </FieldContent>
    </Field>
  );
};
