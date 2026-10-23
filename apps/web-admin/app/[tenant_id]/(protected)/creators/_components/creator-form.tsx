import * as ActionForm from "@publira/ui-components/action-form";
import * as Field from "@publira/ui-components/field";
import { Input } from "@publira/ui-components/input";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Textarea } from "@publira/ui-components/textarea";
import { Suspense } from "react";

import { ImageCropDialogTitle } from "#components/image-crop/crop-dialog";
import { Message } from "#components/message";
import { getMessages } from "#lib/get-messages";

import type { CreatorActionState, CreatorListItem } from "../creator-types";
import {
  CreatorIcon,
  CreatorIconAdjust,
  CreatorIconClear,
  CreatorIconCropDialog,
  CreatorIconFileInput,
  CreatorIconPreview,
} from "./creator-icon-controls";

interface CreatorFormProps {
  mode: "create" | "update";
  action: (
    prevState: CreatorActionState,
    formData: FormData
  ) => Promise<CreatorActionState>;
  initialCreator?: CreatorListItem;
  tenantId: string;
}

/** Awaits the catalog for its placeholders, which are attributes rather than nodes. */
export const CreatorForm = async ({
  mode,
  action,
  initialCreator,
  tenantId,
}: CreatorFormProps) => {
  const t = await getMessages();
  const isUpdate = mode === "update";
  const iconImageUrl = initialCreator?.iconImageUrl ?? "";

  return (
    <ActionForm.Root action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_id" type="hidden" value={initialCreator?.id ?? ""} />

      <ActionForm.Fieldset className="grid gap-4">
        <Field.Root>
          <Field.Label required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.creators.form.name" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Input
              defaultValue={initialCreator?.name}
              name="name"
              placeholder={t("admin.creators.form.name_placeholder")}
              required
              type="text"
            />
          </Field.Content>
        </Field.Root>

        <Field.Root>
          <Field.Label>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.creators.form.profile" />
            </Suspense>
          </Field.Label>
          <Field.Content>
            <Textarea
              defaultValue={initialCreator?.profileText}
              name="profile_text"
              placeholder={t("admin.creators.form.profile_placeholder")}
              rows={5}
            />
            <Field.Description>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.creators.form.profile_description" />
              </Suspense>
            </Field.Description>
          </Field.Content>
        </Field.Root>

        {/*
          The saved icon's timestamp keys the field, so a save that replaced
          or removed the icon remounts it: the picked file, its frame, and the
          deletion checkbox all belong to that save and none of them mean
          anything afterwards.
        */}
        <CreatorIcon
          iconImageUrl={iconImageUrl}
          key={initialCreator?.iconImageUpdatedAt ?? ""}
        >
          <Field.Root>
            <Field.Label>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.creators.form.icon" />
              </Suspense>
            </Field.Label>
            <Field.Content>
              <CreatorIconPreview />
              <CreatorIconFileInput />
              <CreatorIconAdjust>
                <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                  <Message message="admin.image_crop.adjust" />
                </Suspense>
              </CreatorIconAdjust>
              {isUpdate && iconImageUrl ? (
                <CreatorIconClear>
                  <Suspense fallback={<SkeletonLine className="h-4 w-48" />}>
                    <Message message="admin.creators.form.clear_icon" />
                  </Suspense>
                </CreatorIconClear>
              ) : null}
              <Field.Description>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.creators.form.icon_description" />
                </Suspense>
              </Field.Description>
            </Field.Content>

            <CreatorIconCropDialog>
              <ImageCropDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                  <Message message="admin.creators.form.icon_crop_title" />
                </Suspense>
              </ImageCropDialogTitle>
            </CreatorIconCropDialog>
          </Field.Root>
        </CreatorIcon>
      </ActionForm.Fieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionForm.Submit>
          <ActionForm.Idle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              {isUpdate ? (
                <Message message="admin.creators.form.update" />
              ) : (
                <Message message="admin.creators.form.create" />
              )}
            </Suspense>
          </ActionForm.Idle>
          <ActionForm.Pending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.creators.form.submitting" />
            </Suspense>
          </ActionForm.Pending>
        </ActionForm.Submit>
      </div>
    </ActionForm.Root>
  );
};
