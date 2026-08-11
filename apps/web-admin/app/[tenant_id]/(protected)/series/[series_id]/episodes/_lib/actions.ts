"use server";

import {
  DEFAULT_TIME_ZONE,
  parseInstant,
  toInstantIsoString,
} from "@publira/utils";
import { redirect } from "next/navigation";

import { createEpisode, reorderEpisodePage } from "#lib/episode";

import type { EpisodeActionState } from "../episode-types";

interface EpisodeCreateErrorState {
  ok: false;
  message: string;
  mode: "create";
}

const parseCreateEpisodeInput = (formData: FormData) => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const priceRaw = String(formData.get("price") ?? "").trim();
  const readingPeriodHoursRaw = String(
    formData.get("reading_period_hours") ?? ""
  ).trim();
  const publishAtRaw = String(formData.get("publish_at") ?? "").trim();

  return {
    price: Math.trunc(Number(priceRaw)),
    publishAtRaw,
    readingPeriodHours: Math.trunc(Number(readingPeriodHoursRaw)),
    seriesPublicId,
    tenantId,
    title,
  };
};

const validateCreateEpisodeInput = (
  input: ReturnType<typeof parseCreateEpisodeInput>
): EpisodeCreateErrorState | null => {
  if (!input.tenantId) {
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

  // The form posts a `datetime-local` wall clock; read it in the admin UI's
  // display zone instead of whatever zone the server process happens to run in.
  const value = toInstantIsoString(publishAtRaw, DEFAULT_TIME_ZONE);
  const parsed = parseInstant(value);
  if (!parsed) {
    return {
      message: "publish_at の形式が正しくありません。",
      mode: "create",
      ok: false,
    };
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return {
      message: "publish_at は現在時刻より未来を指定してください。",
      mode: "create",
      ok: false,
    };
  }

  return { ok: true, value };
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

  // orderIndex は送らない。ListEpisodes がページ単位で返すようになったため
  // 全件を読んで末尾を数える形は使えず、末尾への追加はサーバーが決める。
  const result = await createEpisode({
    price: input.price,
    publishAt: scheduledAt.value,
    readingPeriodHours: input.readingPeriodHours,
    seriesPublicId: input.seriesPublicId,
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

  redirect(
    `/series/${input.seriesPublicId}/episodes/${result.episode.publicId}?created=1`
  );
};

export const reorderEpisodesAction = async (formData: FormData) => {
  "use server";

  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const seriesPublicId = String(formData.get("series_public_id") ?? "").trim();
  const orderedEpisodeIdsRaw = String(
    formData.get("ordered_episode_public_ids") ?? ""
  ).trim();

  if (!tenantId || !seriesPublicId || !orderedEpisodeIdsRaw) {
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

  // The list screen posts the order of the page that was dragged on, not of the
  // whole series; the merge back into the series' order happens in the lib.
  const reordered = await reorderEpisodePage({
    episodePublicIds: orderedEpisodeIds,
    seriesPublicId,
    tenantId,
  });
  if (!reordered.ok) {
    return reordered;
  }

  return {
    ok: true,
  };
};
