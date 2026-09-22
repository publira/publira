"use client";

import { Button } from "@publira/ui-components/button";
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@publira/ui-components/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
import { FormMessage } from "@publira/ui-components/form-message";
import { Input } from "@publira/ui-components/input";
import Image from "next/image";
import { useActionState, useRef, useState } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage, useClientMessages } from "#components/client-message";
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
  const t = useClientMessages();
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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <ClientMessage message="admin.settings.icon.title" />
          </AdminSectionTitle>
          <AdminSectionDescription>
            <ClientMessage message="admin.settings.icon.description" />
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-5" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.icon.current" />
          </FieldLabel>
          <FieldContent>
            {preview ? (
              <Image
                alt={t("admin.settings.icon.current")}
                className="size-16 rounded-control border bg-card object-contain"
                height={preview.height}
                src={preview.url}
                width={preview.width}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <ClientMessage message="admin.settings.icon.unset" />
              </p>
            )}
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <ClientMessage message="admin.settings.icon.file" />
          </FieldLabel>
          <FieldContent>
            <Input
              accept="image/jpeg,image/png,image/webp"
              name="icon"
              type="file"
            />
            <FieldDescription>
              <ClientMessage message="admin.settings.icon.file_description" />
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
            <ConfirmDialog>
              <ConfirmDialogTrigger
                render={
                  <Button disabled={isPending} type="button" variant="outline">
                    <ClientMessage message="admin.settings.delete" />
                  </Button>
                }
              />
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    <ClientMessage message="admin.settings.icon.delete_title" />
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    <ClientMessage message="admin.settings.icon.delete_description" />
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>
                    <ClientMessage message="admin.common.cancel" />
                  </ConfirmDialogCancel>
                  <ConfirmDialogAction
                    onClick={() => {
                      formRef.current?.requestSubmit(deleteButtonRef.current);
                    }}
                  >
                    <ClientMessage message="admin.settings.delete_action" />
                  </ConfirmDialogAction>
                </ConfirmDialogFooter>
              </ConfirmDialogContent>
            </ConfirmDialog>
          ) : null}
          <button
            className="hidden"
            name="intent"
            ref={deleteButtonRef}
            type="submit"
            value="delete"
          >
            <ClientMessage message="admin.settings.icon.delete_submit" />
          </button>
          <Button
            disabled={isPending}
            name="intent"
            type="submit"
            value="upload"
          >
            {isPending
              ? t("admin.settings.saving")
              : t("admin.settings.icon.submit")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
