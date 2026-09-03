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
import { ConfirmDialog } from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import { useActionState, useContext, useRef, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { tenantBrandingVariant } from "#lib/tenant-branding-image";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantIconActionState } from "../settings-types";

interface TenantIconFormProps {
  action: (
    prevState: TenantIconActionState,
    formData: FormData
  ) => Promise<TenantIconActionState>;
  initialIcon: TenantBrandingImage | null;
}

export const TenantIconForm = ({
  action,
  initialIcon,
}: TenantIconFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // What the card shows is the last icon the server confirmed, so uploading is
  // what replaces it. Deriving it from `state` instead would put the pre-upload
  // image back the moment a later attempt is rejected, because a failure
  // carries no icon of its own.
  const [icon, setIcon] = useState(initialIcon);
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: TenantIconActionState,
      formData: FormData
    ): Promise<TenantIconActionState> => {
      const nextState = await action(previousState, formData);
      if (nextState?.ok) {
        setIcon(nextState.icon);
      }
      return nextState;
    },
    null
  );

  const preview = tenantBrandingVariant(icon);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.icon.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.icon.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" ref={formRef}>
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.icon.current")}
            </FieldLabel>
            <FieldContent>
              {preview ? (
                <Image
                  alt={getMessage(messages, "admin.settings.icon.current")}
                  className="size-16 rounded-md border bg-card object-contain"
                  height={preview.height}
                  src={preview.url}
                  width={preview.width}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {getMessage(messages, "admin.settings.icon.unset")}
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.icon.file")}
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="icon"
                type="file"
              />
              <FieldDescription>
                {getMessage(messages, "admin.settings.icon.file_description")}
              </FieldDescription>
            </FieldContent>
          </Field>

          {state ? (
            <FormMessage variant={state.ok ? "success" : "destructive"}>
              {state.message}
            </FormMessage>
          ) : null}

          <div className="flex justify-end gap-2">
            {preview ? (
              <ConfirmDialog
                actionText={getMessage(
                  messages,
                  "admin.settings.delete_action"
                )}
                actionVariant="destructive"
                description={getMessage(
                  messages,
                  "admin.settings.icon.delete_description"
                )}
                onAction={() => {
                  formRef.current?.requestSubmit(deleteButtonRef.current);
                }}
                title={getMessage(messages, "admin.settings.icon.delete_title")}
                trigger={
                  <Button disabled={isPending} type="button" variant="outline">
                    {getMessage(messages, "admin.settings.delete")}
                  </Button>
                }
              />
            ) : null}
            <button
              className="hidden"
              name="intent"
              ref={deleteButtonRef}
              type="submit"
              value="delete"
            >
              {getMessage(messages, "admin.settings.icon.delete_submit")}
            </button>
            <Button
              disabled={isPending}
              name="intent"
              type="submit"
              value="upload"
            >
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.icon.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
