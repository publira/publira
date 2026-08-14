"use server";

import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  flagOneFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { createLabel, updateLabel } from "#lib/label";

import type { LabelActionState, LabelMutationMode } from "../label-types";

const labelCommonSchema = z.object({
  eyeCatchImage: optionalFileFormSchema,
  name: requiredTrimmedString("レーベル名は必須です。"),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
});

const labelUpdateSchema = labelCommonSchema.extend({
  clearEyeCatchImage: flagOneFormSchema,
  currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
  publicId: requiredTrimmedString("更新対象のレーベル ID が見つかりません。"),
});

const labelFormFields = {
  eyeCatchImage: { kind: "file", name: "eye_catch_image" },
  name: "value",
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toFailure = (
  message: string,
  mode: LabelMutationMode
): LabelActionState => ({
  message,
  mode,
  ok: false,
});

const toEyeCatchImage = async (file: File | undefined) => {
  if (!file) {
    return {
      eyeCatchImageContentType: undefined,
      eyeCatchImageData: undefined,
    };
  }

  return {
    eyeCatchImageContentType: file.type || undefined,
    eyeCatchImageData: new Uint8Array(await file.arrayBuffer()),
  };
};

export const createLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const parsed = labelCommonSchema.safeParse(
    toFormDataInput(formData, labelFormFields)
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "create");
  }

  const { eyeCatchImage, name, tenantId } = parsed.data;
  const { eyeCatchImageContentType, eyeCatchImageData } =
    await toEyeCatchImage(eyeCatchImage);

  const result = await createLabel({
    eyeCatchImageContentType,
    eyeCatchImageData,
    name,
    tenantId,
  });

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  updateTag(`labels-${tenantId}`);

  redirect(`/labels/${result.label.publicId}?created=1`);
};

export const updateLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const parsed = labelUpdateSchema.safeParse(
    toFormDataInput(formData, {
      ...labelFormFields,
      clearEyeCatchImage: { kind: "value", name: "clear_eye_catch_image" },
      currentEyeCatchImageUpdatedAt: {
        kind: "value",
        name: "current_eye_catch_image_updated_at",
      },
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "update");
  }

  const {
    clearEyeCatchImage,
    currentEyeCatchImageUpdatedAt,
    eyeCatchImage,
    name,
    publicId,
    tenantId,
  } = parsed.data;
  const { eyeCatchImageContentType, eyeCatchImageData } =
    await toEyeCatchImage(eyeCatchImage);

  const result = await updateLabel({
    clearEyeCatchImage,
    eyeCatchImageContentType,
    eyeCatchImageData,
    name,
    publicId,
    tenantId,
  });

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    (result.label.eyeCatchImageVariants?.length ?? 0) === 0
  ) {
    return toFailure(
      "アップロードは受け付けましたが、生成画像を確認できませんでした。再試行してください。",
      "update"
    );
  }

  if (
    eyeCatchImageData &&
    !clearEyeCatchImage &&
    currentEyeCatchImageUpdatedAt.length > 0 &&
    result.label.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return toFailure(
      "アップロード処理が反映されていません。画像を選び直して再試行してください。",
      "update"
    );
  }

  updateTag(`labels-${tenantId}`);
  updateTag(`label-${tenantId}-${publicId}`);

  return {
    label: result.label,
    message: "レーベルを更新しました。",
    mode: "update",
    ok: true,
  };
};
