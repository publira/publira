"use server";

import { getMessage } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionMessages } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { createEpisode, reorderEpisodePage } from "#lib/episode";
import {
  jsonStringArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import type { AdminMessages } from "#lib/locale";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { EpisodeActionState } from "../episode-types";

const createEpisodeSchema = (messages: AdminMessages) =>
  z.object({
    price: nonNegativeIntFormSchema(
      getMessage(messages, "admin.series.episodes.validation.price_invalid")
    ),
    publishAt: optionalTrimmedString(),
    readingPeriodHours: nonNegativeIntFormSchema(
      getMessage(
        messages,
        "admin.series.episodes.validation.reading_period_invalid"
      )
    ),
    seriesPublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.tenant_missing")
    ),
    title: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.title_required")
    ),
  });

const reorderEpisodesSchema = (messages: AdminMessages) =>
  z.object({
    currentEpisodeIds: jsonStringArrayFormSchema,
    orderedEpisodeIds: jsonStringArrayFormSchema,
    seriesPublicId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.sort_data_missing")
    ),
    tenantId: requiredTrimmedString(
      getMessage(messages, "admin.series.episodes.validation.sort_data_missing")
    ),
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
  tenantId: string,
  messages: AdminMessages
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
    return toCreateFailure(
      getMessage(
        messages,
        "admin.series.episodes.validation.publish_at_invalid"
      )
    );
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toCreateFailure(
      getMessage(messages, "admin.series.episodes.validation.publish_at_future")
    );
  }

  return { ok: true, value };
};

export const createEpisodeAction = async (
  _prevState: EpisodeActionState,
  formData: FormData
): Promise<EpisodeActionState> => {
  await assertSameOrigin();
  const messages = await getActionMessages(formData);
  const parsed = createEpisodeSchema(messages).safeParse(
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
    parsed.data.tenantId,
    messages
  );
  if (!scheduledAt.ok) {
    return scheduledAt;
  }

  // orderIndex は送らない。ListEpisodes がページ単位で返すようになったため
  // 全件を読んで末尾を数える形は使えず、末尾への追加はサーバーが決める。
  const result = await withAdminSessionReauth(() =>
    createEpisode({
      price: parsed.data.price,
      publishAt: scheduledAt.value,
      readingPeriodHours: parsed.data.readingPeriodHours,
      seriesPublicId: parsed.data.seriesPublicId,
      tenantId: parsed.data.tenantId,
      title: parsed.data.title,
    })
  );

  if (!result.ok) {
    return toCreateFailure(result.message);
  }

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${result.episode.publicId}?created=1`
  );
};

export const reorderEpisodesAction = async (formData: FormData) => {
  "use server";

  await assertSameOrigin();
  const messages = await getActionMessages(formData);
  const parsed = reorderEpisodesSchema(messages).safeParse(
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
        fallback: getMessage(
          messages,
          "admin.series.episodes.validation.sort_data_missing"
        ),
      }),
      ok: false,
    };
  }

  if (parsed.data.orderedEpisodeIds.length === 0) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.no_episodes_to_sort"
      ),
      ok: false,
    };
  }

  if (
    parsed.data.currentEpisodeIds.length !==
    parsed.data.orderedEpisodeIds.length
  ) {
    return {
      message: getMessage(
        messages,
        "admin.series.episodes.validation.sort_data_missing"
      ),
      ok: false,
    };
  }

  // The list screen posts the order of the page that was dragged on, not of the
  // whole series; the merge back into the series' order happens in the lib.
  const reordered = await withAdminSessionReauth(() =>
    reorderEpisodePage({
      currentEpisodePublicIds: parsed.data.currentEpisodeIds,
      episodePublicIds: parsed.data.orderedEpisodeIds,
      seriesPublicId: parsed.data.seriesPublicId,
      tenantId: parsed.data.tenantId,
    })
  );
  if (!reordered.ok) {
    return reordered;
  }

  return {
    ok: true,
  };
};
