"use client";

import { getMessage } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import { Button } from "@publira/ui-components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@publira/ui-components/card";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useState } from "react";
import type { ChangeEvent } from "react";

import { useTenantId } from "#lib/use-tenant-id";

import type { LabelActionState, LabelListItem } from "../label-types";

interface LabelFormProps {
  mode: "create" | "update";
  action: (
    prevState: LabelActionState,
    formData: FormData
  ) => Promise<LabelActionState>;
  initialLabel?: LabelListItem;
}

const getSubmitLabel = (
  messages: ReturnType<typeof sharedCatalog>,
  isUpdate: boolean,
  isPending: boolean
): string => {
  if (isPending) {
    return getMessage(messages, "admin.labels.form.submitting");
  }
  if (isUpdate) {
    return getMessage(messages, "admin.labels.form.update");
  }
  return getMessage(messages, "admin.labels.form.create");
};

const getCardTitle = (
  messages: ReturnType<typeof sharedCatalog>,
  isUpdate: boolean
): string => {
  if (isUpdate) {
    return getMessage(messages, "admin.labels.form.update_card_title");
  }
  return getMessage(messages, "admin.labels.form.create_card_title");
};

const getCardDescription = (
  messages: ReturnType<typeof sharedCatalog>,
  isUpdate: boolean
): string => {
  if (isUpdate) {
    return getMessage(messages, "admin.labels.form.update_description");
  }
  return getMessage(messages, "admin.labels.form.create_description");
};

export const LabelForm = ({ mode, action, initialLabel }: LabelFormProps) => {
  const messages = sharedCatalog(
    typeof document === "undefined" ? undefined : document.documentElement.lang
  );
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  const initialName = initialLabel?.name ?? "";
  const [name, setName] = useState(initialName);
  const [prevInitialName, setPrevInitialName] = useState(initialName);
  const [prevMode, setPrevMode] = useState(mode);

  if (initialName !== prevInitialName || mode !== prevMode) {
    setPrevInitialName(initialName);
    setPrevMode(mode);
    setName(initialName);
  }

  // Successful create redirects from the server action (see createLabelAction).
  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";
  const submitLabel = getSubmitLabel(messages, isUpdate, isPending);
  const cardTitle = getCardTitle(messages, isUpdate);
  const cardDescription = getCardDescription(messages, isUpdate);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{cardTitle}</CardTitle>
        <CardDescription>{cardDescription}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4">
          <input name="tenant_id" type="hidden" value={tenantId} />
          <input
            name="public_id"
            type="hidden"
            value={initialLabel?.publicId ?? ""}
          />

          <Field>
            <FieldLabel required>
              {getMessage(messages, "admin.labels.form.name")}
            </FieldLabel>
            <FieldContent>
              <Input
                name="name"
                onChange={handleNameChange}
                placeholder={getMessage(
                  messages,
                  "admin.labels.form.name_placeholder"
                )}
                required
                type="text"
                value={name}
              />
            </FieldContent>
          </Field>

          {isUpdate ? null : (
            <Field>
              <FieldLabel>
                {getMessage(messages, "admin.labels.form.eye_catch")}
              </FieldLabel>
              <FieldContent>
                <Input
                  accept="image/jpeg,image/png,image/webp"
                  name="eye_catch_image"
                  type="file"
                />
                <p className="text-sm text-muted-foreground">
                  {getMessage(
                    messages,
                    "admin.labels.form.eye_catch_description"
                  )}
                </p>
              </FieldContent>
            </Field>
          )}

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button disabled={isPending} type="submit">
              {submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
