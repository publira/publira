import {
  ActionForm,
  ActionFormFieldset,
  ActionFormIdle,
  ActionFormPending,
  ActionFormSubmit,
} from "@publira/ui-components/action-form";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@publira/ui-components/field";
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
    <ActionForm action={action} className="grid gap-4">
      <input name="tenant_id" type="hidden" value={tenantId} />
      <input name="creator_id" type="hidden" value={initialCreator?.id ?? ""} />

      <ActionFormFieldset className="grid gap-4">
        <Field>
          <FieldLabel required>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.creators.form.name" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Input
              defaultValue={initialCreator?.name}
              name="name"
              placeholder={t("admin.creators.form.name_placeholder")}
              required
              type="text"
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel>
            <Suspense fallback={<SkeletonLine className="h-4 w-16" />}>
              <Message message="admin.creators.form.profile" />
            </Suspense>
          </FieldLabel>
          <FieldContent>
            <Textarea
              defaultValue={initialCreator?.profileText}
              name="profile_text"
              placeholder={t("admin.creators.form.profile_placeholder")}
              rows={5}
            />
            <FieldDescription>
              <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                <Message message="admin.creators.form.profile_description" />
              </Suspense>
            </FieldDescription>
          </FieldContent>
        </Field>

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
          <Field>
            <FieldLabel>
              <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
                <Message message="admin.creators.form.icon" />
              </Suspense>
            </FieldLabel>
            <FieldContent>
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
              <FieldDescription>
                <Suspense fallback={<SkeletonLine className="h-4 w-3/4" />}>
                  <Message message="admin.creators.form.icon_description" />
                </Suspense>
              </FieldDescription>
            </FieldContent>

            <CreatorIconCropDialog>
              <ImageCropDialogTitle>
                <Suspense fallback={<SkeletonLine className="h-6 w-40" />}>
                  <Message message="admin.creators.form.icon_crop_title" />
                </Suspense>
              </ImageCropDialogTitle>
            </CreatorIconCropDialog>
          </Field>
        </CreatorIcon>
      </ActionFormFieldset>

      <div className="mt-2 flex justify-end gap-2">
        <ActionFormSubmit>
          <ActionFormIdle>
            <Suspense fallback={<SkeletonLine className="h-4 w-24" />}>
              {isUpdate ? (
                <Message message="admin.creators.form.update" />
              ) : (
                <Message message="admin.creators.form.create" />
              )}
            </Suspense>
          </ActionFormIdle>
          <ActionFormPending>
            <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
              <Message message="admin.creators.form.submitting" />
            </Suspense>
          </ActionFormPending>
        </ActionFormSubmit>
      </div>
    </ActionForm>
  );
};
