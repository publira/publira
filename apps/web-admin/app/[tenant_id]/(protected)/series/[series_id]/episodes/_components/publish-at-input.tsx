"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";

import { useAdminMessage } from "#components/client-message";

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
  const t = useAdminMessage();

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
          {t("admin.series.episodes.form.publish_at_description", {
            time_zone: timeZone,
          })}
        </FieldDescription>
      </FieldContent>
    </Field>
  );
};
