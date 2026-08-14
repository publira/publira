"use server";

import { toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  nonNegativeIntFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  trimmedStringListFormSchema,
} from "#lib/form-schemas";
import { createSeries, updateSeries } from "#lib/series";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { SeriesActionState, SeriesMutationMode } from "../series-types";

/**
 * `published_at` arrives either as an absolute timestamp (the form resolves
 * the wall clock against the zone it was rendered in) or as a leftover
 * zone-less `datetime-local` value. The latter is read in the tenant's
 * current display zone rather than being glued to a hardcoded `+09:00` or
 * reinterpreted in the server's local zone.
 */
const seriesCommonSchema = z.object({
  creatorPublicIds: trimmedStringListFormSchema,
  eyeCatchImage: optionalFileFormSchema,
  isPublished: checkboxOnFormSchema,
  labelPublicId: requiredTrimmedString("レーベルは必須です。"),
  publishedAt: optionalTrimmedString(),
  readingPeriodHours: nonNegativeIntFormSchema(
    "閲覧可能期間は 0 以上の整数で入力してください。"
  ),
  synopsis: requiredTrimmedString("概要は必須です。", 10_000),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  title: requiredTrimmedString("タイトルは必須です。"),
});

const seriesUpdateSchema = seriesCommonSchema.extend({
  publicId: requiredTrimmedString("更新対象のシリーズ ID が見つかりません。"),
});

const seriesEyeCatchSchema = seriesUpdateSchema.extend({
  clearEyeCatchImage: flagOneFormSchema,
  currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
});

const seriesFormFields = {
  creatorPublicIds: { kind: "values", name: "creator_public_ids" },
  eyeCatchImage: { kind: "file", name: "eye_catch_image" },
  isPublished: { kind: "value", name: "is_published" },
  labelPublicId: { kind: "value", name: "label_public_id" },
  publishedAt: { kind: "value", name: "published_at" },
  readingPeriodHours: { kind: "value", name: "reading_period_hours" },
  synopsis: "value",
  tenantId: { kind: "value", name: "tenant_id" },
  title: "value",
} as const;

const toFailure = (
  message: string,
  mode: SeriesMutationMode
): { message: string; mode: SeriesMutationMode; ok: false } => ({
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

const resolvePublishedAt = async (
  publishedAtRaw: string,
  tenantId: string,
  mode: SeriesMutationMode
): Promise<
  { ok: true; publishedAt: string } | ReturnType<typeof toFailure>
> => {
  if (!publishedAtRaw) {
    return { ok: true, publishedAt: "" };
  }

  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const publishedAt = toInstantIsoString(publishedAtRaw, timeZone);
  if (publishedAtRaw.length > 0 && publishedAt.length === 0) {
    return toFailure("公開日時の形式が正しくありません。", mode);
  }

  return { ok: true, publishedAt };
};

export const createSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const parsed = seriesCommonSchema.safeParse(
    toFormDataInput(formData, seriesFormFields)
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "create");
  }

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "create"
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  const result = await createSeries({
    creatorPublicIds: parsed.data.creatorPublicIds,
    eyeCatchImageContentType,
    eyeCatchImageData,
    isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
    labelPublicId: parsed.data.labelPublicId,
    publishedAt: schedule.publishedAt,
    readingPeriodHours: parsed.data.readingPeriodHours,
    synopsis: parsed.data.synopsis,
    tenantId: parsed.data.tenantId,
    title: parsed.data.title,
  });

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  redirect(`/series/${result.series.publicId}?created=1`);
};

export const updateSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const parsed = seriesUpdateSchema.safeParse(
    toFormDataInput(formData, {
      ...seriesFormFields,
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "update");
  }

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "update"
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  const result = await updateSeries({
    creatorPublicIds: parsed.data.creatorPublicIds,
    eyeCatchImageContentType,
    eyeCatchImageData,
    isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
    labelPublicId: parsed.data.labelPublicId,
    publicId: parsed.data.publicId,
    publishedAt: schedule.publishedAt,
    readingPeriodHours: parsed.data.readingPeriodHours,
    synopsis: parsed.data.synopsis,
    tenantId: parsed.data.tenantId,
    title: parsed.data.title,
  });

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  redirect(`/series/${parsed.data.publicId}?updated=1`);
};

export const updateSeriesEyeCatchAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  const parsed = seriesEyeCatchSchema.safeParse(
    toFormDataInput(formData, {
      ...seriesFormFields,
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

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "update"
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  if (!parsed.data.clearEyeCatchImage && !eyeCatchImageData) {
    return toFailure(
      "画像を選択するか、削除チェックを選んでください。",
      "update"
    );
  }

  const result = await updateSeries({
    clearEyeCatchImage: parsed.data.clearEyeCatchImage,
    creatorPublicIds: parsed.data.creatorPublicIds,
    eyeCatchImageContentType,
    eyeCatchImageData,
    isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
    labelPublicId: parsed.data.labelPublicId,
    publicId: parsed.data.publicId,
    publishedAt: schedule.publishedAt,
    readingPeriodHours: parsed.data.readingPeriodHours,
    synopsis: parsed.data.synopsis,
    tenantId: parsed.data.tenantId,
    title: parsed.data.title,
  });

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  if (
    eyeCatchImageData &&
    !parsed.data.clearEyeCatchImage &&
    (result.series.eyeCatchImageVariants?.length ?? 0) === 0
  ) {
    return toFailure(
      "アップロードは受け付けましたが、生成画像を確認できませんでした。再試行してください。",
      "update"
    );
  }

  if (
    eyeCatchImageData &&
    !parsed.data.clearEyeCatchImage &&
    parsed.data.currentEyeCatchImageUpdatedAt.length > 0 &&
    result.series.eyeCatchImageUpdatedAt ===
      parsed.data.currentEyeCatchImageUpdatedAt
  ) {
    return toFailure(
      "アップロード処理が反映されていません。画像を選び直して再試行してください。",
      "update"
    );
  }

  return {
    message: "アイキャッチを更新しました。",
    mode: "update",
    ok: true,
    series: result.series,
  };
};
