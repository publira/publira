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
import { useActionState, useContext, useRef, useState } from "react";

import { AdminLocaleContext } from "#components/admin-locale-context";
import { tenantBrandingVariant } from "#lib/tenant-branding-image";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";
import { useTenantId } from "#lib/use-tenant-id";

import type { TenantLogoActionState } from "../settings-types";

interface TenantLogoFormProps {
  action: (
    prevState: TenantLogoActionState,
    formData: FormData
  ) => Promise<TenantLogoActionState>;
  initialLogo: TenantBrandingImage | null;
}

export const TenantLogoForm = ({
  action,
  initialLogo,
}: TenantLogoFormProps) => {
  const locale = useContext(AdminLocaleContext);
  if (locale === null) {
    throw new Error("AdminLocaleProvider is required.");
  }
  const messages = sharedCatalog(locale);
  const tenantId = useTenantId();
  const formRef = useRef<HTMLFormElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);

  // What the card shows is the last logo the server confirmed, so uploading is
  // what replaces it. Deriving it from `state` instead would put the pre-upload
  // image back the moment a later attempt is rejected, because a failure
  // carries no logo of its own.
  const [logo, setLogo] = useState(initialLogo);
  const [state, formAction, isPending] = useActionState(
    async (
      previousState: TenantLogoActionState,
      formData: FormData
    ): Promise<TenantLogoActionState> => {
      const nextState = await action(previousState, formData);
      if (nextState?.ok) {
        setLogo(nextState.logo);
      }
      return nextState;
    },
    null
  );

  // The stored master carries its own width and height, so the preview is laid
  // out at the logo's real aspect ratio instead of a guessed one.
  const preview = tenantBrandingVariant(logo);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {getMessage(messages, "admin.settings.logo.title")}
        </CardTitle>
        <CardDescription>
          {getMessage(messages, "admin.settings.logo.description")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" ref={formRef}>
          <input name="tenant_id" type="hidden" value={tenantId} />

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.logo.current")}
            </FieldLabel>
            <FieldContent>
              {preview ? (
                <Image
                  alt={getMessage(messages, "admin.settings.logo.current")}
                  className="h-16 w-auto max-w-full rounded-md border bg-card object-contain"
                  height={preview.height}
                  src={preview.url}
                  width={preview.width}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {getMessage(messages, "admin.settings.logo.unset")}
                </p>
              )}
            </FieldContent>
          </Field>

          <Field>
            <FieldLabel>
              {getMessage(messages, "admin.settings.logo.file")}
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="logo"
                type="file"
              />
              <FieldDescription>
                {getMessage(messages, "admin.settings.logo.file_description")}
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
                    <Button
                      disabled={isPending}
                      type="button"
                      variant="outline"
                    >
                      {getMessage(messages, "admin.settings.delete")}
                    </Button>
                  }
                />
                <ConfirmDialogContent>
                  <ConfirmDialogHeader>
                    <ConfirmDialogTitle>
                      {getMessage(messages, "admin.settings.logo.delete_title")}
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      {getMessage(
                        messages,
                        "admin.settings.logo.delete_description"
                      )}
                    </ConfirmDialogDescription>
                  </ConfirmDialogHeader>
                  <ConfirmDialogFooter>
                    <ConfirmDialogCancel>
                      {getMessage(messages, "admin.common.cancel")}
                    </ConfirmDialogCancel>
                    <ConfirmDialogAction
                      onClick={() => {
                        formRef.current?.requestSubmit(deleteButtonRef.current);
                      }}
                      variant="destructive"
                    >
                      {getMessage(messages, "admin.settings.delete_action")}
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
              {getMessage(messages, "admin.settings.logo.delete_submit")}
            </button>
            <Button
              disabled={isPending}
              name="intent"
              type="submit"
              value="upload"
            >
              {isPending
                ? getMessage(messages, "admin.settings.saving")
                : getMessage(messages, "admin.settings.logo.submit")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
};
