"use client";

import { Button } from "@publira/ui-components/button";
import { Field, FieldContent, FieldLabel } from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import { useActionState, useCallback, useContext, useState } from "react";
import type { ChangeEvent } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { ClientMessage, useClientMessages } from "#components/client-message";
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

const LabelFormSubmitLabel = ({
  isPending,
  isUpdate,
}: {
  isPending: boolean;
  isUpdate: boolean;
}) => {
  if (isPending) {
    return <ClientMessage message="admin.labels.form.submitting" />;
  }

  return isUpdate ? (
    <ClientMessage message="admin.labels.form.update" />
  ) : (
    <ClientMessage message="admin.labels.form.create" />
  );
};

export const LabelForm = ({ mode, action, initialLabel }: LabelFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const t = useClientMessages();
  const tenantId = useTenantId();
  const [state, formAction, isPending] = useActionState(action, null);
  // Seeded once per mount: the edit route keys this form by the label's public
  // id, so switching to another label remounts it with that label's name.
  const [name, setName] = useState(initialLabel?.name ?? "");

  // Successful create redirects from the server action (see createLabelAction).
  const handleNameChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setName(event.target.value);
    },
    []
  );

  const isUpdate = mode === "update";

  return (
    <form action={formAction} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input
        name="public_id"
        type="hidden"
        value={initialLabel?.publicId ?? ""}
      />

      <Field>
        <FieldLabel required>
          <ClientMessage message="admin.labels.form.name" />
        </FieldLabel>
        <FieldContent>
          <Input
            disabled={isPending}
            name="name"
            onChange={handleNameChange}
            placeholder={t("admin.labels.form.name_placeholder")}
            required
            type="text"
            value={name}
          />
        </FieldContent>
      </Field>

      {isUpdate ? null : (
        <Field>
          <FieldLabel>
            <ClientMessage message="admin.labels.form.eye_catch" />
          </FieldLabel>
          <FieldContent>
            <Input
              accept="image/jpeg,image/png,image/webp"
              disabled={isPending}
              name="eye_catch_image"
              type="file"
            />
            <p className="text-sm text-muted-foreground">
              <ClientMessage message="admin.labels.form.eye_catch_description" />
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
          <LabelFormSubmitLabel isPending={isPending} isUpdate={isUpdate} />
        </Button>
      </div>
    </form>
  );
};
