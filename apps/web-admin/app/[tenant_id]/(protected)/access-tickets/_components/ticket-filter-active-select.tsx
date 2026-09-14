"use client";

import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { useId } from "react";

import { useAdminMessages } from "#components/admin-locale-context";

interface TicketFilterActiveSelectProps {
  defaultValue: string;
}

export const TicketFilterActiveSelect = ({
  defaultValue,
}: TicketFilterActiveSelectProps) => {
  const t = useAdminMessages();
  // Native <select> is not a Field control, so the label needs an id to point at.
  const activeSelectId = useId();

  return (
    <Field>
      <FieldLabel htmlFor={activeSelectId}>
        {t("admin.access_tickets.filter.status")}
      </FieldLabel>
      <FieldContent>
        <select
          className="flex h-10 w-full rounded-control border border-input bg-background px-3 py-2 text-sm text-foreground"
          defaultValue={defaultValue}
          id={activeSelectId}
          name="active"
        >
          <option value="">
            {t("admin.access_tickets.filter.status_all")}
          </option>
          <option value="1">
            {t("admin.access_tickets.filter.status_active_only")}
          </option>
        </select>
      </FieldContent>
    </Field>
  );
};
