"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";

import { createLabel, updateLabel } from "#lib/label";

import type { LabelActionState } from "../label-types";

const parseCommonFields = async (formData: FormData) => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  const eyeCatchImageFile = formData.get("eye_catch_image");
  let eyeCatchImageData: Uint8Array | undefined;
  let eyeCatchImageContentType: string | undefined;
  if (eyeCatchImageFile instanceof File && eyeCatchImageFile.size > 0) {
    eyeCatchImageData = new Uint8Array(await eyeCatchImageFile.arrayBuffer());
    eyeCatchImageContentType = eyeCatchImageFile.type || undefined;
  }

  return {
    eyeCatchImageContentType,
    eyeCatchImageData,
    name,
    tenantId,
  };
};

const validateCommonFields = (
  input: Awaited<ReturnType<typeof parseCommonFields>>,
  mode: "create" | "update"
): LabelActionState | null => {
  if (!input.tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.name) {
    return {
      message: "レーベル名は必須です。",
      mode,
      ok: false,
    };
  }

  return null;
};

export const createLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const input = await parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "create");
  if (commonValidation) {
    return commonValidation;
  }

  const result = await createLabel({
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    name: input.name,
    tenantId: input.tenantId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "create",
      ok: false,
    };
  }

  updateTag(`labels-${input.tenantId}`);

  redirect(`/labels/${result.label.publicId}?created=1`);
};

export const updateLabelAction = async (
  _prevState: LabelActionState,
  formData: FormData
): Promise<LabelActionState> => {
  const input = await parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "update");
  if (commonValidation) {
    return commonValidation;
  }

  const publicId = String(formData.get("public_id") ?? "").trim();
  if (!publicId) {
    return {
      message: "更新対象のレーベル ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }

  const clearEyeCatchImage =
    String(formData.get("clear_eye_catch_image") ?? "") === "1";
  const currentEyeCatchImageUpdatedAt = String(
    formData.get("current_eye_catch_image_updated_at") ?? ""
  ).trim();

  const result = await updateLabel({
    clearEyeCatchImage,
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    name: input.name,
    publicId,
    tenantId: input.tenantId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "update",
      ok: false,
    };
  }

  if (
    input.eyeCatchImageData &&
    !clearEyeCatchImage &&
    (result.label.eyeCatchImageVariants?.length ?? 0) === 0
  ) {
    return {
      message:
        "アップロードは受け付けましたが、生成画像を確認できませんでした。再試行してください。",
      mode: "update",
      ok: false,
    };
  }

  if (
    input.eyeCatchImageData &&
    !clearEyeCatchImage &&
    currentEyeCatchImageUpdatedAt.length > 0 &&
    result.label.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return {
      message:
        "アップロード処理が反映されていません。画像を選び直して再試行してください。",
      mode: "update",
      ok: false,
    };
  }

  updateTag(`labels-${input.tenantId}`);
  updateTag(`label-${input.tenantId}-${publicId}`);

  return {
    label: result.label,
    message: "レーベルを更新しました。",
    mode: "update",
    ok: true,
  };
};
