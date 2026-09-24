"use client";

import type { FormActionState } from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import { Checkbox } from "@publira/ui-components/checkbox";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState } from "react";

import { ClientMessage } from "#components/client-message";
import {
  PlatformSection,
  PlatformSectionDescription,
  PlatformSectionHeader,
  PlatformSectionHeading,
  PlatformSectionTitle,
} from "#components/platform-page";

type Message = Parameters<typeof ClientMessage>[0]["message"];

export interface PolicyNumberField {
  defaultValue: number;
  label: Message;
  name: string;
}

interface PolicyFormProps {
  action: (
    previousState: FormActionState,
    formData: FormData
  ) => Promise<FormActionState>;
  checkbox?: { defaultChecked: boolean; label: Message; name: string };
  description: Message;
  fields: PolicyNumberField[];
  help?: Message;
  loadErrorMessage?: string;
  revision: string;
  submit: Message;
  title: Message;
}

export const PolicyForm = ({
  action,
  checkbox,
  description,
  fields,
  help,
  loadErrorMessage,
  revision,
  submit,
  title,
}: PolicyFormProps) => {
  const [state, formAction, isPending] = useActionState(action, null);
  const hasLoadError = Boolean(loadErrorMessage);

  return (
    <PlatformSection>
      <PlatformSectionHeader>
        <PlatformSectionHeading>
          <PlatformSectionTitle>
            <ClientMessage message={title} />
          </PlatformSectionTitle>
          <PlatformSectionDescription>
            <ClientMessage message={description} />
          </PlatformSectionDescription>
        </PlatformSectionHeading>
      </PlatformSectionHeader>
      <form action={formAction} className="grid gap-4 sm:max-w-3xl">
        <input name="revision" type="hidden" value={revision} />
        {help ? (
          <p className="text-xs text-muted-foreground">
            <ClientMessage message={help} />
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <Field key={field.name}>
              <FieldLabel required>
                <ClientMessage message={field.label} />
              </FieldLabel>
              <FieldContent>
                <Input
                  defaultValue={String(field.defaultValue)}
                  disabled={hasLoadError}
                  min={1}
                  name={field.name}
                  required
                  type="number"
                />
              </FieldContent>
            </Field>
          ))}
        </div>
        {checkbox ? (
          <Field className="flex items-center gap-2">
            <Checkbox
              defaultChecked={checkbox.defaultChecked}
              disabled={hasLoadError}
              name={checkbox.name}
            />
            <FieldLabel>
              <ClientMessage message={checkbox.label} />
            </FieldLabel>
          </Field>
        ) : null}
        {loadErrorMessage ? (
          <FormMessage variant="destructive">{loadErrorMessage}</FormMessage>
        ) : null}
        {state ? (
          <FormMessage variant={state.ok ? "success" : "destructive"}>
            {state.message}
          </FormMessage>
        ) : null}
        <div className="mt-2 flex justify-end">
          <Button disabled={hasLoadError || isPending} type="submit">
            <ClientMessage message={submit} />
          </Button>
        </div>
      </form>
    </PlatformSection>
  );
};
