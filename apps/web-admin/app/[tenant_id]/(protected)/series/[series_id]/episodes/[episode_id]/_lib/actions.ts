"use server";

import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  reorderEpisodeImages,
  updateEpisodePublishSchedule,
  uploadEpisodePages,
} from "#lib/episode";
import {
  fileListFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  EpisodeEditActionState,
  EpisodeEditMode,
} from "../episode-edit-types";

const hiddenParamsSchema = z.object({
  episodePublicId: requiredTrimmedString("エピソード ID が見つかりません。"),
  seriesPublicId: requiredTrimmedString("シリーズ ID が見つかりません。"),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
});

const scheduleFormSchema = hiddenParamsSchema.extend({
  publishAt: optionalTrimmedString(),
});

const uploadModeSchema = z.preprocess(
  (value) => {
    if (value === "zip" || value === "epub" || value === "pages") {
      return value;
    }

    return "pages";
  },
  z.enum(["pages", "zip", "epub"])
);

const uploadPagesFormSchema = hiddenParamsSchema.extend({
  archive: optionalFileFormSchema,
  pages: fileListFormSchema,
  uploadMode: uploadModeSchema,
});

const jsonStringArraySchema = z.preprocess((value): string[] => {
  if (typeof value !== "string" || value.trim() === "") {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}, z.array(z.string()));

const reorderImagesSchema = hiddenParamsSchema
  .extend({
    orderedImageIds: jsonStringArraySchema,
  })
  .extend({
    episodePublicId: requiredTrimmedString(
      "並び順の更新に必要な情報が不足しています。"
    ),
    seriesPublicId: requiredTrimmedString(
      "並び順の更新に必要な情報が不足しています。"
    ),
    tenantId: requiredTrimmedString(
      "並び順の更新に必要な情報が不足しています。"
    ),
  });

const hiddenFormFields = {
  episodePublicId: { kind: "value", name: "episode_public_id" },
  seriesPublicId: { kind: "value", name: "series_public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

const toFailure = (
  message: string,
  mode: EpisodeEditMode
): { message: string; mode: EpisodeEditMode; ok: false } => ({
  message,
  mode,
  ok: false,
});

const parsePublishAtToRFC3339 = async (
  value: string,
  tenantId: string
): Promise<{ ok: true; iso: string } | ReturnType<typeof toFailure>> => {
  if (!value) {
    return { iso: "", ok: true };
  }

  // The form posts an absolute instant resolved against the zone it was
  // rendered in. A leftover `datetime-local` wall clock (no JS) is still
  // accepted and read in the tenant's current display zone.
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const iso = toInstantIsoString(value, timeZone);
  const parsed = parseInstant(iso);
  if (!parsed) {
    return toFailure("publish_at の形式が正しくありません。", "schedule");
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toFailure(
      "publish_at は現在時刻より未来を指定してください。",
      "schedule"
    );
  }

  return { iso, ok: true };
};

export const updateEpisodeScheduleAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  const parsed = scheduleFormSchema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      publishAt: { kind: "value", name: "publish_at" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "schedule");
  }

  const schedule = await parsePublishAtToRFC3339(
    parsed.data.publishAt,
    parsed.data.tenantId
  );
  if (!schedule.ok) {
    return schedule;
  }

  const result = await updateEpisodePublishSchedule({
    episodePublicId: parsed.data.episodePublicId,
    publishAt: schedule.iso,
    tenantId: parsed.data.tenantId,
  });

  if (!result.ok) {
    return toFailure(result.message, "schedule");
  }

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?schedule_updated=1`
  );
};

export const uploadEpisodePagesAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  const parsed = uploadPagesFormSchema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      archive: { kind: "file", name: "archive" },
      pages: { kind: "files", name: "pages" },
      uploadMode: { kind: "value", name: "upload_mode" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error), "pages");
  }

  const {
    archive,
    episodePublicId,
    pages,
    seriesPublicId,
    tenantId,
    uploadMode,
  } = parsed.data;

  if (uploadMode === "zip" || uploadMode === "epub") {
    if (!archive) {
      return toFailure(
        uploadMode === "zip"
          ? "入稿する ZIP ファイルを選択してください。"
          : "入稿する ePub ファイルを選択してください。",
        "pages"
      );
    }

    const normalizedName = archive.name.toLowerCase();
    const mime = archive.type.toLowerCase();
    const isValidArchive =
      uploadMode === "zip"
        ? mime === "application/zip" || normalizedName.endsWith(".zip")
        : mime.includes("application/epub+zip") ||
          normalizedName.endsWith(".epub");

    if (!isValidArchive) {
      return toFailure(
        uploadMode === "zip"
          ? "ZIP 形式（.zip）のファイルを選択してください。"
          : "ePub 形式（.epub）のファイルを選択してください。",
        "pages"
      );
    }

    const result = await uploadEpisodePages({
      archive,
      episodePublicId,
      seriesPublicId,
      tenantId,
    });

    if (!result.ok) {
      return toFailure(result.message, "pages");
    }

    redirect(
      `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
    );
  }

  if (pages.length === 0) {
    return toFailure("追加するページ画像を選択してください。", "pages");
  }

  const result = await uploadEpisodePages({
    episodePublicId,
    pages,
    tenantId,
  });

  if (!result.ok) {
    return toFailure(result.message, "pages");
  }

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
  );
};

export const reorderEpisodeImagesAction = async (formData: FormData) => {
  "use server";

  const parsed = reorderImagesSchema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      orderedImageIds: { kind: "value", name: "ordered_image_ids" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: "並び順の更新に必要な情報が不足しています。",
      }),
      ok: false,
    };
  }

  if (parsed.data.orderedImageIds.length === 0) {
    return {
      message: "並び替え対象の画像がありません。",
      ok: false,
    };
  }

  const result = await reorderEpisodeImages({
    episodePublicId: parsed.data.episodePublicId,
    imageIds: parsed.data.orderedImageIds,
    tenantId: parsed.data.tenantId,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
  };
};
