"use server";

import { redirect } from "next/navigation";

import {
  reorderEpisodeImages,
  updateEpisodePublishSchedule,
  uploadEpisodePages,
} from "../../../../../../../../lib/episode";
import type { EpisodeEditActionState } from "../episode-edit-types";

interface EpisodeEditErrorState {
  ok: false;
  message: string;
  mode: "schedule" | "pages";
}

const parseHiddenParams = (formData: FormData) => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const episodePublicId = String(
    formData.get("episode_public_id") ?? ""
  ).trim();

  return {
    episodePublicId,
    seriesPublicId,
    tenantPublicId,
  };
};

const validateHiddenParams = (
  input: ReturnType<typeof parseHiddenParams>,
  mode: "schedule" | "pages"
): EpisodeEditErrorState | null => {
  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.seriesPublicId) {
    return {
      message: "シリーズ ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  if (!input.episodePublicId) {
    return {
      message: "エピソード ID が見つかりません。",
      mode,
      ok: false,
    };
  }

  return null;
};

const parsePublishAtToRFC3339 = (
  value: string
): { ok: true; iso: string } | EpisodeEditErrorState => {
  const trimmed = value.trim();
  if (!trimmed) {
    return { iso: "", ok: true };
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return {
      message: "publish_at の形式が正しくありません。",
      mode: "schedule",
      ok: false,
    };
  }

  if (parsed.getTime() <= Date.now()) {
    return {
      message: "publish_at は現在時刻より未来を指定してください。",
      mode: "schedule",
      ok: false,
    };
  }

  return {
    iso: parsed.toISOString(),
    ok: true,
  };
};

export const updateEpisodeScheduleAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  const hidden = parseHiddenParams(formData);
  const hiddenValidation = validateHiddenParams(hidden, "schedule");
  if (hiddenValidation) {
    return hiddenValidation;
  }

  const publishAtRaw = String(formData.get("publish_at") ?? "");
  const schedule = parsePublishAtToRFC3339(publishAtRaw);
  if (!schedule.ok) {
    return schedule;
  }

  const result = await updateEpisodePublishSchedule({
    episodePublicId: hidden.episodePublicId,
    publishAt: schedule.iso,
    tenantPublicId: hidden.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "schedule",
      ok: false,
    };
  }

  redirect(
    `/series/${hidden.seriesPublicId}/episodes/${hidden.episodePublicId}?schedule_updated=1`
  );
};

export const uploadEpisodePagesAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  const hidden = parseHiddenParams(formData);
  const hiddenValidation = validateHiddenParams(hidden, "pages");
  if (hiddenValidation) {
    return hiddenValidation;
  }

  const pages = formData
    .getAll("pages")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (pages.length === 0) {
    return {
      message: "追加するページ画像を選択してください。",
      mode: "pages",
      ok: false,
    };
  }

  const result = await uploadEpisodePages({
    episodePublicId: hidden.episodePublicId,
    pages,
    tenantPublicId: hidden.tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      mode: "pages",
      ok: false,
    };
  }

  redirect(
    `/series/${hidden.seriesPublicId}/episodes/${hidden.episodePublicId}?pages_uploaded=1`
  );
};

export const reorderEpisodeImagesAction = async (formData: FormData) => {
  "use server";

  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const episodePublicId = String(
    formData.get("episode_public_id") ?? ""
  ).trim();
  const orderedImageIdsRaw = String(
    formData.get("ordered_image_ids") ?? ""
  ).trim();

  if (
    !tenantPublicId ||
    !seriesPublicId ||
    !episodePublicId ||
    !orderedImageIdsRaw
  ) {
    return {
      message: "並び順の更新に必要な情報が不足しています。",
      ok: false,
    };
  }

  let orderedImageIds: string[];
  try {
    const parsed = JSON.parse(orderedImageIdsRaw);
    orderedImageIds = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    orderedImageIds = [];
  }

  if (orderedImageIds.length === 0) {
    return {
      message: "並び替え対象の画像がありません。",
      ok: false,
    };
  }

  const result = await reorderEpisodeImages({
    episodePublicId,
    imageIds: orderedImageIds,
    tenantPublicId,
  });

  if (!result.ok) {
    return result;
  }

  return {
    ok: true,
  };
};
