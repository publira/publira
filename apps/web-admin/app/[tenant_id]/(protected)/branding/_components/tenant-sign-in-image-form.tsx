import * as ConsoleSection from "@publira/layouts/admin/console-section";
import * as ActionForm from "@publira/ui-components/action-form";
import { Button } from "@publira/ui-components/button";
import * as ConfirmDialog from "@publira/ui-components/confirm-dialog";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import Image from "next/image";
import { Suspense } from "react";

import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";
import { tenantBrandingVariant } from "#lib/tenant-branding-image";
import type { TenantBrandingImage } from "#lib/tenant-branding-image";

import { updateTenantSignInImageAction } from "../_lib/actions";

const FORM_ID = "tenant-sign-in-image-form";

/**
 * The preview's height in CSS pixels, matching its `h-40`. A stored image can
 * be 2560px on its longer side, so the preview's `width` and `height` are the
 * size it is drawn at rather than the master's: `next/image` builds the 1x and
 * 2x candidates from them, and the master's own size would have the image
 * server send several megapixels for a thumbnail.
 */
const PREVIEW_HEIGHT = 160;

interface TenantSignInImageFormProps {
  signInImage: TenantBrandingImage | null;
  tenantId: string;
}

/**
 * Uploads and deletes the image the public site shows beside its sign-in and
 * sign-up forms. Both post to one Action, told apart by `intent`, and a save
 * redraws the card from the stored image.
 */
export const TenantSignInImageForm = async ({
  signInImage,
  tenantId,
}: TenantSignInImageFormProps) => {
  const t = await getMessages();
  // The whole stored image is previewed at its own aspect ratio. The site crops
  // it to fit its panel, and which part survives depends on the window, so the
  // card does not pretend to know the crop.
  const preview = tenantBrandingVariant(signInImage);

  return (
    <ConsoleSection.Root>
      <ConsoleSection.Header>
        <ConsoleSection.Heading>
          <ConsoleSection.Title>
            <Suspense fallback={<SkeletonLine className="h-5 w-24" />}>
              <Message message="admin.settings.sign_in_image.title" />
            </Suspense>
          </ConsoleSection.Title>
          <ConsoleSection.Description>
            <Suspense fallback={<SkeletonLine className="h-4 w-80" />}>
              <Message message="admin.settings.sign_in_image.description" />
            </Suspense>
          </ConsoleSection.Description>
        </ConsoleSection.Heading>
      </ConsoleSection.Header>

      <ActionForm.Root
        action={updateTenantSignInImageAction}
        className="grid gap-5"
        id={FORM_ID}
      >
        <input name="tenant_id" type="hidden" value={tenantId} />

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              <Message message="admin.settings.sign_in_image.current" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            {preview ? (
              <Image
                alt={t("admin.settings.sign_in_image.current")}
                className="h-40 w-auto max-w-full rounded-control border bg-card object-contain"
                height={PREVIEW_HEIGHT}
                src={preview.url}
                width={Math.max(
                  1,
                  Math.round((preview.width * PREVIEW_HEIGHT) / preview.height)
                )}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                <Suspense fallback={<SkeletonLine className="h-4 w-32" />}>
                  <Message message="admin.settings.sign_in_image.unset" />
                </Suspense>
              </p>
            )}
          </Field.Content>
        </Field.Root>

        <ActionForm.Fieldset>
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.settings.sign_in_image.file" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <Input
                accept="image/jpeg,image/png,image/webp"
                name="sign_in_image"
                type="file"
              />
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.settings.sign_in_image.file_description" />
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
                        <Message message="admin.settings.sign_in_image.delete_title" />
                      </Suspense>
                    </ConfirmDialog.Title>
                    <ConfirmDialog.Description>
                      <Suspense
                        fallback={<SkeletonLine className="h-4 w-72" />}
                      >
                        <Message message="admin.settings.sign_in_image.delete_description" />
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
                <Message message="admin.settings.sign_in_image.submit" />
              </ActionForm.Idle>
              <ActionForm.Pending>
                <Message message="admin.settings.saving" />
              </ActionForm.Pending>
            </Suspense>
          </ActionForm.Submit>
        </div>
      </ActionForm.Root>
    </ConsoleSection.Root>
  );
};
