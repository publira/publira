"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { useContext } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";

interface PublishAtInputProps {
  defaultValue?: string;
  name?: string;
  timeZone: string;
}

export const PublishAtInput = ({
  defaultValue,
  name = "publish_at",
  timeZone,
}: PublishAtInputProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);

  return (
    <Field>
      <FieldLabel>publish_at</FieldLabel>
      <FieldContent>
        <input defaultValue="" name={name} type="hidden" />
        <Input
          defaultValue={defaultValue}
          name={`${name}_local`}
          step={60}
          type="datetime-local"
        />
        <FieldDescription>
          {getMessage(
            messages,
            "admin.series.episodes.form.publish_at_description",
            {
              time_zone: timeZone,
            }
          )}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
