"use client";

import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";

interface PublishAtInputProps {
  /** What a value means on this form; the create form and the schedule differ. */
  children: ReactNode;
  defaultValue?: string;
  name?: string;
}

export const PublishAtInput = ({
  children,
  defaultValue,
  name = "publish_at",
}: PublishAtInputProps) => (
  <Field>
    <FieldLabel>
      <ClientMessage message="admin.series.episodes.form.publish_at" />
    </FieldLabel>
    <FieldContent>
      <input defaultValue="" name={name} type="hidden" />
      <Input
        defaultValue={defaultValue}
        name={`${name}_local`}
        step={60}
        type="datetime-local"
      />
      <FieldDescription>{children}</FieldDescription>
    </FieldContent>
  </Field>
);
