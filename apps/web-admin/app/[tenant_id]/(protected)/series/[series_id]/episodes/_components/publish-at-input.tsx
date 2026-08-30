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
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );

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
