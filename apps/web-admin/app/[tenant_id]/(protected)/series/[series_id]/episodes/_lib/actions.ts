"use server";

import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createEpisode, reorderEpisodePage } from "#lib/episode";
import {
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { EpisodeActionState } from "../episode-types";

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

const createEpisodeSchema = z.object({
  price: nonNegativeIntFormSchema("価格は 0 以上の整数で入力してください。"),
  publishAt: optionalTrimmedString(),
  readingPeriodHours: nonNegativeIntFormSchema(
    "閲覧可能期間は 0 以上の整数で入力してください。"
  ),
  seriesPublicId: requiredTrimmedString("シリーズ ID が見つかりません。"),
  tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  title: requiredTrimmedString("タイトルは必須です。"),
});

const reorderEpisodesSchema = z.object({
  currentEpisodeIds: jsonStringArraySchema,
  orderedEpisodeIds: jsonStringArraySchema,
  seriesPublicId: requiredTrimmedString(
    "並び順の更新に必要な情報が不足しています。"
  ),
  tenantId: requiredTrimmedString("並び順の更新に必要な情報が不足しています。"),
});

const toCreateFailure = (
  message: string
): { message: string; mode: "create"; ok: false } => ({
  message,
  mode: "create",
  ok: false,
});

const toScheduledAt = async (
  publishAtRaw: string,
  tenantId: string
): Promise<
  { ok: true; value: string } | ReturnType<typeof toCreateFailure>
> => {
  if (!publishAtRaw) {
    return { ok: true, value: "" };
  }

  // The form posts an absolute instant resolved against the zone it was
  // rendered in. A leftover `datetime-local` wall clock (no JS) is still
  // accepted and read in the tenant's current display zone.
  const timeZone = await getTenantDisplayTimeZone(tenantId);
  const value = toInstantIsoString(publishAtRaw, timeZone);
  const parsed = parseInstant(value);
  if (!parsed) {
    return toCreateFailure("publish_at の形式が正しくありません。");
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toCreateFailure("publish_at は現在時刻より未来を指定してください。");
  }

  return { ok: true, value };
};

export const createEpisodeAction = async (
  _prevState: EpisodeActionState,
  formData: FormData
): Promise<EpisodeActionState> => {
  const parsed = createEpisodeSchema.safeParse(
    toFormDataInput(formData, {
      price: "value",
      publishAt: { kind: "value", name: "publish_at" },
      readingPeriodHours: { kind: "value", name: "reading_period_hours" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
      tenantId: { kind: "value", name: "tenant_id" },
      title: "value",
    })
  );
  if (!parsed.success) {
    return toCreateFailure(toFormErrorMessage(parsed.error));
  }

  const scheduledAt = await toScheduledAt(
    parsed.data.publishAt,
    parsed.data.tenantId
  );
  if (!scheduledAt.ok) {
    return scheduledAt;
  }

  // orderIndex は送らない。ListEpisodes がページ単位で返すようになったため
  // 全件を読んで末尾を数える形は使えず、末尾への追加はサーバーが決める。
  const result = await createEpisode({
    price: parsed.data.price,
    publishAt: scheduledAt.value,
    readingPeriodHours: parsed.data.readingPeriodHours,
    seriesPublicId: parsed.data.seriesPublicId,
    tenantId: parsed.data.tenantId,
    title: parsed.data.title,
  });

  if (!result.ok) {
    return toCreateFailure(result.message);
  }

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${result.episode.publicId}?created=1`
  );
};

export const reorderEpisodesAction = async (formData: FormData) => {
  "use server";

  const parsed = reorderEpisodesSchema.safeParse(
    toFormDataInput(formData, {
      currentEpisodeIds: { kind: "value", name: "current_episode_public_ids" },
      orderedEpisodeIds: { kind: "value", name: "ordered_episode_public_ids" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
      tenantId: { kind: "value", name: "tenant_id" },
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

  if (parsed.data.orderedEpisodeIds.length === 0) {
    return {
      message: "並び替え対象のエピソードがありません。",
      ok: false,
    };
  }

  if (
    parsed.data.currentEpisodeIds.length !==
    parsed.data.orderedEpisodeIds.length
  ) {
    return {
      message: "並び順の更新に必要な情報が不足しています。",
      ok: false,
    };
  }

  // The list screen posts the order of the page that was dragged on, not of the
  // whole series; the merge back into the series' order happens in the lib.
  const reordered = await reorderEpisodePage({
    currentEpisodePublicIds: parsed.data.currentEpisodeIds,
    episodePublicIds: parsed.data.orderedEpisodeIds,
    seriesPublicId: parsed.data.seriesPublicId,
    tenantId: parsed.data.tenantId,
  });
  if (!reordered.ok) {
    return reordered;
  }

  return {
    ok: true,
  };
};
