"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useContext, useId } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

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
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  // Native <select> is not a Field control, so the label needs an id to point at.
  const statusSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={statusSelectId}>
        {getMessage(sharedCatalog(locale), "admin.comments.filter.status")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
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
