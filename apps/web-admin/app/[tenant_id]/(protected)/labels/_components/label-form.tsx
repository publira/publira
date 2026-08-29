"use client";

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

import { useAdminMessage } from "#components/client-message";
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
  t: ReturnType<typeof useAdminMessage>,
  isUpdate: boolean,
  isPending: boolean
): string => {
  if (isPending) {
    return t("admin.labels.form.submitting");
  }
  if (isUpdate) {
    return t("admin.labels.form.update");
  }
  return t("admin.labels.form.create");
};

const getCardTitle = (
  t: ReturnType<typeof useAdminMessage>,
  isUpdate: boolean
): string => {
  if (isUpdate) {
    return t("admin.labels.form.update_card_title");
  }
  return t("admin.labels.form.create_card_title");
};

const getCardDescription = (
  t: ReturnType<typeof useAdminMessage>,
  isUpdate: boolean
): string => {
  if (isUpdate) {
    return t("admin.labels.form.update_description");
  }
  return t("admin.labels.form.create_description");
};

export const LabelForm = ({ mode, action, initialLabel }: LabelFormProps) => {
  const t = useAdminMessage();
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
  const submitLabel = getSubmitLabel(t, isUpdate, isPending);
  const cardTitle = getCardTitle(t, isUpdate);
  const cardDescription = getCardDescription(t, isUpdate);

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
            <FieldLabel required>{t("admin.labels.form.name")}</FieldLabel>
            <FieldContent>
              <Input
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
              <FieldLabel>{t("admin.labels.form.eye_catch")}</FieldLabel>
              <FieldContent>
                <Input
                  accept="image/jpeg,image/png,image/webp"
                  name="eye_catch_image"
                  type="file"
                />
                <p className="text-sm text-muted-foreground">
                  {t("admin.labels.form.eye_catch_description")}
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
