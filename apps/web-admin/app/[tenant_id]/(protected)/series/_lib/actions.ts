"use server";

import { toInstantIsoString } from "@publira/utils";
import { redirect } from "next/navigation";

import { createSeries, updateSeries } from "#lib/series";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { SeriesActionState } from "../series-types";

/**
 * `published_at` arrives either as an absolute timestamp or as the zone-less
 * wall clock of a `datetime-local` input. The wall clock is read in the
 * tenant's display zone rather than being glued to a hardcoded `+09:00` or
 * reinterpreted in the server's local zone.
 */
const parsePublishedAt = (value: string, timeZone: string): string =>
  toInstantIsoString(value, timeZone);

const parseCommonFields = async (formData: FormData) => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const synopsis = String(formData.get("synopsis") ?? "").trim();
  const labelPublicId = String(formData.get("label_public_id") ?? "").trim();
  const publishedAtRaw = String(formData.get("published_at") ?? "").trim();
  const readingPeriodHoursRaw = String(
    formData.get("reading_period_hours") ?? ""
  ).trim();
  const isPublished = String(formData.get("is_published") ?? "") === "on";
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const publishedAt = parsePublishedAt(publishedAtRaw, timeZone);
  const creatorPublicIds = formData
    .getAll("creator_public_ids")
    .flatMap((value) => {
      const trimmed = String(value).trim();
      return trimmed.length > 0 ? [trimmed] : [];
    });
  const readingPeriodHours = Math.trunc(Number(readingPeriodHoursRaw));

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
    publishedAt,
    publishedAtRaw,
    readingPeriodHours,
    synopsis,
    tenantId,
    title,
  };
};

const validateCommonFields = (
  input: Awaited<ReturnType<typeof parseCommonFields>>,
  mode: "create" | "update"
): SeriesActionState | null => {
  if (!input.tenantId) {
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

  if (input.publishedAtRaw.length > 0 && input.publishedAt.length === 0) {
    return {
      message: "公開日時の形式が正しくありません。",
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
    isPublished: input.isPublished || input.publishedAt.length > 0,
    labelPublicId: input.labelPublicId,
    publishedAt: input.publishedAt,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantId: input.tenantId,
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

  const result = await updateSeries({
    creatorPublicIds: input.creatorPublicIds,
    eyeCatchImageContentType: input.eyeCatchImageContentType,
    eyeCatchImageData: input.eyeCatchImageData,
    isPublished: input.isPublished || input.publishedAt.length > 0,
    labelPublicId: input.labelPublicId,
    publicId,
    publishedAt: input.publishedAt,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantId: input.tenantId,
    title: input.title,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "update",
      ok: false,
    };
  }

  redirect(`/series/${publicId}?updated=1`);
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
    isPublished: input.isPublished || input.publishedAt.length > 0,
    labelPublicId: input.labelPublicId,
    publicId,
    publishedAt: input.publishedAt,
    readingPeriodHours: input.readingPeriodHours,
    synopsis: input.synopsis,
    tenantId: input.tenantId,
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
