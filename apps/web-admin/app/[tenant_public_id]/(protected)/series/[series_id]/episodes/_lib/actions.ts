"use server";

import { redirect } from "next/navigation";

import {
  createEpisode,
  listEpisodes,
  reorderEpisodes,
} from "../../../../../../../lib/episode";
import type { EpisodeActionState } from "../episode-types";

interface EpisodeCreateErrorState {
  ok: false;
  message: string;
  mode: "create";
}

const parseCreateEpisodeInput = (formData: FormData) => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const readingPeriodHoursRaw = String(
    formData.get("reading_period_hours") ?? ""
  ).trim();
  const publishAtRaw = String(formData.get("publish_at") ?? "").trim();

  return {
    price: Number.parseInt(priceRaw, 10),
    publishAtRaw,
    readingPeriodHours: Number.parseInt(readingPeriodHoursRaw, 10),
    seriesPublicId,
    tenantPublicId,
    title,
  };
};

const validateCreateEpisodeInput = (
  input: ReturnType<typeof parseCreateEpisodeInput>
): EpisodeCreateErrorState | null => {
  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      mode: "create",
      ok: false,
    };
  }

  if (!input.seriesPublicId) {
    return {
      message: "シリーズ ID が見つかりません。",
      mode: "create",
      ok: false,
    };
  }

  if (!input.title) {
    return {
      message: "タイトルは必須です。",
      mode: "create",
      ok: false,
    };
  }

  if (Number.isNaN(input.price) || input.price < 0) {
    return {
      message: "価格は 0 以上の整数で入力してください。",
      mode: "create",
      ok: false,
    };
  }

  if (Number.isNaN(input.readingPeriodHours) || input.readingPeriodHours < 0) {
    return {
      message: "閲覧可能期間は 0 以上の整数で入力してください。",
      mode: "create",
      ok: false,
    };
  }

  return null;
};

const toScheduledAt = (
  publishAtRaw: string
): { ok: true; value: string } | EpisodeCreateErrorState => {
  if (!publishAtRaw) {
    return { ok: true, value: "" };
  }

  const parsed = new Date(publishAtRaw);
  if (Number.isNaN(parsed.getTime())) {
    return {
      message: "publish_at の形式が正しくありません。",
      mode: "create",
      ok: false,
    };
  }

  if (parsed.getTime() <= Date.now()) {
    return {
      message: "publish_at は現在時刻より未来を指定してください。",
      mode: "create",
      ok: false,
    };
  }

  return {
    ok: true,
    value: parsed.toISOString(),
  };
};

export const createEpisodeAction = async (
  _prevState: EpisodeActionState,
  formData: FormData
): Promise<EpisodeActionState> => {
  const input = parseCreateEpisodeInput(formData);
  const validation = validateCreateEpisodeInput(input);
  if (validation) {
    return validation;
  }

  const scheduledAt = toScheduledAt(input.publishAtRaw);
  if (!scheduledAt.ok) {
    return scheduledAt;
  }

  const listedEpisodes = await listEpisodes({
    seriesPublicId: input.seriesPublicId,
    tenantPublicId: input.tenantPublicId,
  });
  if (!listedEpisodes.ok) {
    return {
      message: listedEpisodes.message,
      mode: "create",
      ok: false,
    };
  }
  let maxOrderIndex = 0;
  for (const episode of listedEpisodes.episodes) {
    maxOrderIndex = Math.max(maxOrderIndex, episode.orderIndex);
  }
  const nextOrderIndex = maxOrderIndex + 1;

  const result = await createEpisode({
    orderIndex: nextOrderIndex,
    price: input.price,
    publishAt: scheduledAt.value,
    readingPeriodHours: input.readingPeriodHours,
    seriesPublicId: input.seriesPublicId,
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

  redirect(
    `/series/${input.seriesPublicId}/episodes/${result.episode.publicId}?created=1`
  );
};

export const reorderEpisodesAction = async (formData: FormData) => {
  "use server";

  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const orderedEpisodeIdsRaw = String(
    formData.get("ordered_episode_public_ids") ?? ""
  ).trim();

  if (!tenantPublicId || !seriesPublicId || !orderedEpisodeIdsRaw) {
    return {
      message: "並び順の更新に必要な情報が不足しています。",
      ok: false,
    };
  }

  let orderedEpisodeIds: string[];
  try {
    const parsed = JSON.parse(orderedEpisodeIdsRaw);
    orderedEpisodeIds = Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string")
      : [];
  } catch {
    orderedEpisodeIds = [];
  }

  if (orderedEpisodeIds.length === 0) {
    return {
      message: "並び替え対象のエピソードがありません。",
      ok: false,
    };
  }

  const reordered = await reorderEpisodes({
    episodePublicIds: orderedEpisodeIds,
    seriesPublicId,
    tenantPublicId,
  });
  if (!reordered.ok) {
    return reordered;
  }

  return {
    ok: true,
  };
};
