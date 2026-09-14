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
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import { Suspense, useActionState, useRef, useState } from "react";

import { useAdminMessages } from "#components/admin-locale-context";
import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { ClientMessage } from "#components/client-message";
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
  const t = useAdminMessages();
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
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.logo.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.logo.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>
      <form action={formAction} className="grid gap-5" ref={formRef}>
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.logo.current" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            {preview ? (
              <Image
                alt={t("admin.settings.logo.current")}
                className="h-16 w-auto max-w-full rounded-control border bg-card object-contain"
                height={preview.height}
                src={preview.url}
                width={preview.width}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-56" />}>
                  <ClientMessage message="admin.settings.logo.unset" />
                </Suspense>
              </p>
            )}
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
              <ClientMessage message="admin.settings.logo.file" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              accept="image/jpeg,image/png,image/webp"
              name="logo"
              type="file"
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                <ClientMessage message="admin.settings.logo.file_description" />
              </Suspense>
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
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage message="admin.settings.delete" />
                    </Suspense>
                  </Button>
                }
              />
              <ConfirmDialogContent>
                <ConfirmDialogHeader>
                  <ConfirmDialogTitle>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage message="admin.settings.logo.delete_title" />
                    </Suspense>
                  </ConfirmDialogTitle>
                  <ConfirmDialogDescription>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage message="admin.settings.logo.delete_description" />
                    </Suspense>
                  </ConfirmDialogDescription>
                </ConfirmDialogHeader>
                <ConfirmDialogFooter>
                  <ConfirmDialogCancel>
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage message="admin.common.cancel" />
                    </Suspense>
                  </ConfirmDialogCancel>
                  <ConfirmDialogAction
                    onClick={() => {
                      formRef.current?.requestSubmit(deleteButtonRef.current);
                    }}
                  >
                    <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                      <ClientMessage message="admin.settings.delete_action" />
                    </Suspense>
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
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ClientMessage message="admin.settings.logo.delete_submit" />
            </Suspense>
          </button>
          <Button
            disabled={isPending}
            name="intent"
            type="submit"
            value="upload"
          >
            {isPending
              ? t("admin.settings.saving")
              : t("admin.settings.logo.submit")}
          </Button>
        </div>
      </form>
    </AdminSection>
  );
};
