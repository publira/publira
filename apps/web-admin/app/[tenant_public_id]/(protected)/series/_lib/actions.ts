"use server";

import { redirect } from "next/navigation";

import { createSeries, updateSeries } from "#lib/series";

import type { SeriesActionState } from "../series-types";

const parseCommonFields = async (formData: FormData) => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const synopsis = String(formData.get("synopsis") ?? "").trim();
  const labelPublicId = String(formData.get("label_public_id") ?? "").trim();
  const readingPeriodHoursRaw = String(
    formData.get("reading_period_hours") ?? ""
  ).trim();
  const isPublished = String(formData.get("is_published") ?? "") === "on";
  const creatorPublicIds = formData
    .getAll("creator_public_ids")
    .map((value) => String(value).trim())
    .filter((value) => value.length > 0);
  const readingPeriodHours = Number.parseInt(readingPeriodHoursRaw, 10);

  const eyeCatchImageFile = formData.get("eye_catch_image");
  let eyeCatchImageData: Uint8Array | undefined;
  let eyeCatchImageContentType: string | undefined;
  if (eyeCatchImageFile instanceof File && eyeCatchImageFile.size > 0) {
    eyeCatchImageData = new Uint8Array(await eyeCatchImageFile.arrayBuffer());
    eyeCatchImageContentType = eyeCatchImageFile.type || undefined;
  }

  return {
    creatorPublicIds,
    eyeCatchImageContentType,
    eyeCatchImageData,
    isPublished,
    labelPublicId,
    readingPeriodHours,
    synopsis,
    tenantPublicId,
    title,
  };
};

const validateCommonFields = (
  input: Awaited<ReturnType<typeof parseCommonFields>>,
  mode: "create" | "update"
): SeriesActionState | null => {
  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.title) {
    return {
      message: "タイトルは必須です。",
      mode,
      ok: false,
    };
  }

  if (!input.synopsis) {
    return {
      message: "概要は必須です。",
      mode,
      ok: false,
    };
  }

  if (Number.isNaN(input.readingPeriodHours) || input.readingPeriodHours < 0) {
    return {
      message: "閲覧可能期間は 0 以上の整数で入力してください。",
      mode,
      ok: false,
    };
  }

  if (!input.labelPublicId) {
    return {
      message: "レーベルは必須です。",
      mode,
      ok: false,
    };
  }

  return null;
};

export const createSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const input = await parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "create");
  if (commonValidation) {
    return commonValidation;
  }

  const result = await createSeries({
    creatorPublicIds: input.creatorPublicIds,
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    isPublished: input.isPublished,
    labelPublicId: input.labelPublicId,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantPublicId: input.tenantPublicId,
    title: input.title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "create",
      ok: false,
    };
  }

  redirect(`/series/${result.series.publicId}?created=1`);
};

export const updateSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const input = await parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "update");
  if (commonValidation) {
    return commonValidation;
  }

  const publicId = String(formData.get("public_id") ?? "").trim();
  if (!publicId) {
    return {
      message: "更新対象のシリーズ ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }

  const clearEyeCatchImage =
    String(formData.get("clear_eye_catch_image") ?? "") === "1";

  if (!clearEyeCatchImage && !input.eyeCatchImageData) {
    return {
      message: "画像を選択するか、削除チェックを選んでください。",
      mode: "update",
      ok: false,
    };
  }

  const result = await updateSeries({
    clearEyeCatchImage,
    creatorPublicIds: input.creatorPublicIds,
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    isPublished: input.isPublished,
    labelPublicId: input.labelPublicId,
    publicId,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantPublicId: input.tenantPublicId,
    title: input.title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "update",
      ok: false,
    };
  }

  return {
    message: "シリーズを更新しました。",
    mode: "update",
    ok: true,
    series: result.series,
  };
};

export const updateSeriesEyeCatchAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const input = await parseCommonFields(formData);
  const commonValidation = validateCommonFields(input, "update");
  if (commonValidation) {
    return commonValidation;
  }

  const publicId = String(formData.get("public_id") ?? "").trim();
  if (!publicId) {
    return {
      message: "更新対象のシリーズ ID が見つかりません。",
      mode: "update",
      ok: false,
    };
  }

  const clearEyeCatchImage =
    String(formData.get("clear_eye_catch_image") ?? "") === "1";
  const currentEyeCatchImageUpdatedAt = String(
    formData.get("current_eye_catch_image_updated_at") ?? ""
  ).trim();

  if (!clearEyeCatchImage && !input.eyeCatchImageData) {
    return {
      message: "画像を選択するか、削除チェックを選んでください。",
      mode: "update",
      ok: false,
    };
  }

  const result = await updateSeries({
    clearEyeCatchImage,
    creatorPublicIds: input.creatorPublicIds,
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    isPublished: input.isPublished,
    labelPublicId: input.labelPublicId,
    publicId,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantPublicId: input.tenantPublicId,
    title: input.title,
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
    (result.series.eyeCatchImageVariants?.length ?? 0) === 0
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
    result.series.eyeCatchImageUpdatedAt === currentEyeCatchImageUpdatedAt
  ) {
    return {
      message:
        "アップロード処理が反映されていません。画像を選び直して再試行してください。",
      mode: "update",
      ok: false,
    };
  }

  return {
    message: "アイキャッチを更新しました。",
    mode: "update",
    ok: true,
    series: result.series,
  };
};
