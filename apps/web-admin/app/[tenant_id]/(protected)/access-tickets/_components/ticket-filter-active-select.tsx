"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useContext, useId } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

interface TicketFilterActiveSelectProps {
  defaultValue: string;
}

export const TicketFilterActiveSelect = ({
  defaultValue,
}: TicketFilterActiveSelectProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  // Native <select> is not a Field control, so the label needs an id to point at.
  const activeSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={activeSelectId}>
        {getMessage(messages, "admin.access_tickets.filter.status")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-xs"
          defaultValue={defaultValue}
          id={activeSelectId}
          name="active"
        >
          <option value="">
            {getMessage(messages, "admin.access_tickets.filter.status_all")}
          </option>
          <option value="1">
            {getMessage(
              messages,
              "admin.access_tickets.filter.status_active_only"
            )}
          </option>
        </select>
      </FieldContent>
    </Field>
  );
};
