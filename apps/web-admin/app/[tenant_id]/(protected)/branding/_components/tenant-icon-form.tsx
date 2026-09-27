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

import { updateTenantIconAction } from "../_lib/actions";

const FORM_ID = "tenant-icon-form";

interface TenantIconFormProps {
  icon: TenantBrandingImage | null;
  tenantId: string;
}

/**
 * Uploads and deletes the tenant's icon. Both post to one Action, told apart by
 * `intent`, and a save redraws the card from the stored icon.
 */
export const TenantIconForm = async ({
  icon,
  tenantId,
}: TenantIconFormProps) => {
  const t = await getMessages();
  const preview = tenantBrandingVariant(icon);

  return (
    <AdminSection>
      <AdminSectionHeader>
        <AdminSectionHeading>
          <AdminSectionTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
              <Message message="admin.settings.icon.title" />
            </Suspense>
          </AdminSectionTitle>
          <AdminSectionDescription>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.icon.description" />
            </Suspense>
          </AdminSectionDescription>
        </AdminSectionHeading>
      </AdminSectionHeader>

      <ActionForm
        action={updateTenantIconAction}
        className="grid gap-5"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.icon.current" />
            </Suspense>
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
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.icon.unset" />
                </Suspense>
              </p>
            )}
          </FieldContent>
        </Field>

        <ActionFormFieldset>
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.icon.file" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="icon"
                type="file"
              />
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.icon.file_description" />
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
                        <Message message="admin.settings.icon.delete_title" />
                      </Suspense>
                    </ConfirmDialogTitle>
                    <ConfirmDialogDescription>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.icon.delete_description" />
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
                <Message message="admin.settings.icon.submit" />
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
