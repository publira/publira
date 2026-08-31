"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useContext, useId } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

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
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  // Native <select> is not a Field control, so the label needs an id to point at.
  const actionSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={actionSelectId}>
        {getMessage(sharedCatalog(locale), "admin.audit.filter.action")}
      </FieldLabel>
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
