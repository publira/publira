import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
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
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import { Suspense } from "react";

import {
  AdminSection,
  AdminSectionDescription,
  AdminSectionHeader,
  AdminSectionHeading,
  AdminSectionTitle,
} from "#components/admin-page";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { tenantBrandingVariant } from "#lib/tenant-branding-image";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";

import { updateTenantLogoAction } from "../_lib/actions";

const FORM_ID = "tenant-logo-form";

interface TenantLogoFormProps {
  logo: TenantBrandingImage | null;
  tenantId: string;
}

/**
 * Uploads and deletes the tenant's logo. Both post to one Action, told apart by
 * `intent`, and a save redraws the card from the stored logo.
 */
export const TenantLogoForm = async ({
  logo,
  tenantId,
}: TenantLogoFormProps) => {
  const t = await getMessages();
  // The stored master carries its own width and height, so the preview is laid
  // out at the logo's real aspect ratio instead of a guessed one.
  const preview = tenantBrandingVariant(logo);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
              <Message message="admin.settings.logo.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.logo.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      <ActionForm
        action={updateTenantLogoAction}
        className="grid gap-5"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.logo.current" />
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
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.logo.unset" />
                </Suspense>
              </p>
            )}
          </FieldContent>
        </Field>

        <ActionFormFieldset>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.logo.file" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="logo"
                type="file"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.logo.file_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>
          </Field>
        </ActionFormFieldset>

        <div className="flex justify-end gap-2">
          {preview ? (
            <ActionFormFieldset>
              <ConfirmDialog>
                <ConfirmDialogTrigger
                  render={<Button type="button" variant="outline" />}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.settings.delete" />
                  </Suspense>
                </ConfirmDialogTrigger>
                <ConfirmDialogContent>
                  <ConfirmDialogHeader>
                    <ConfirmDialogTitle>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.logo.delete_title" />
                      </Suspense>
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.logo.delete_description" />
                      </Suspense>
                    </ConfirmDialogDescription>
                  </ConfirmDialogHeader>
                  <ConfirmDialogFooter>
                    <ConfirmDialogCancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialogCancel>
                    <ConfirmDialogAction
                      form={FORM_ID}
                      name="intent"
                      value="delete"
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.settings.delete_action" />
                      </Suspense>
                    </ConfirmDialogAction>
                  </ConfirmDialogFooter>
                </ConfirmDialogContent>
              </ConfirmDialog>
            </ActionFormFieldset>
          ) : null}
          <ActionFormSubmit name="intent" value="upload">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionFormIdle>
                <Message message="admin.settings.logo.submit" />
              </ActionFormIdle>
              <ActionFormPending>
                <Message message="admin.settings.saving" />
              </ActionFormPending>
            </Suspense>
          </ActionFormSubmit>
        </div>
      </ActionForm>
    </AdminSection>
  );
};
