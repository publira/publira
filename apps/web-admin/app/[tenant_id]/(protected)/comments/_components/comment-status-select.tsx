"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useId } from "react";

import { useAdminMessages } from "#components/admin-locale-context";

interface CommentStatusOption {
  label: string;
  value: string;
}

interface CommentStatusSelectProps {
  defaultValue: string;
  options: readonly CommentStatusOption[];
}

export const CommentStatusSelect = ({
  defaultValue,
  options,
}: CommentStatusSelectProps) => {
  const t = useAdminMessages();
  // Native <select> is not a Field control, so the label needs an id to point at.
  const statusSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={statusSelectId}>
        {t("admin.comments.filter.status")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
          defaultValue={defaultValue}
          id={statusSelectId}
          name="status"
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
