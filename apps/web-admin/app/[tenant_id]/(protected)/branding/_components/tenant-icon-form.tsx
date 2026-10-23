import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
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

      <ActionForm.Root
        action={updateTenantIconAction}
        className="grid gap-5"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.icon.current" />
            </Suspense>
          </Field.Label>
          <Field.Content>
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
          </Field.Content>
        </Field.Root>

        <ActionForm.Fieldset>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.icon.file" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="icon"
                type="file"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.icon.file_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>
          </Field.Root>
        </ActionForm.Fieldset>

        <div className="flex justify-end gap-2">
          {preview ? (
            <ActionForm.Fieldset>
              <ConfirmDialog.Root>
                <ConfirmDialog.Trigger
                  render={<Button type="button" variant="outline" />}
                >
                  <Suspense fallback={<SkeletonLine className="h-4 w-12" />}>
                    <Message message="admin.settings.delete" />
                  </Suspense>
                </ConfirmDialog.Trigger>
                <ConfirmDialog.Content>
                  <ConfirmDialog.Header>
                    <ConfirmDialog.Title>
                      <Suspense
                        fallback={<SkeletonLine className="h-5 w-48" />}
                      >
                        <Message message="admin.settings.icon.delete_title" />
                      </Suspense>
                    </ConfirmDialog.Title>
                    <ConfirmDialog.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.icon.delete_description" />
                      </Suspense>
                    </ConfirmDialog.Description>
                  </ConfirmDialog.Header>
                  <ConfirmDialog.Footer>
                    <ConfirmDialog.Cancel>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.common.cancel" />
                      </Suspense>
                    </ConfirmDialog.Cancel>
                    <ConfirmDialog.Action
                      form={FORM_ID}
                      name="intent"
                      value="delete"
                    >
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-12" />}
                      >
                        <Message message="admin.settings.delete_action" />
                      </Suspense>
                    </ConfirmDialog.Action>
                  </ConfirmDialog.Footer>
                </ConfirmDialog.Content>
              </ConfirmDialog.Root>
            </ActionForm.Fieldset>
          ) : null}
          <ActionForm.Submit name="intent" value="upload">
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <ActionForm.Idle>
                <Message message="admin.settings.icon.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </AdminSection>
  );
};
