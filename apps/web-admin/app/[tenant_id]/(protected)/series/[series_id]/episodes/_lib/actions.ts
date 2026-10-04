"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
import { listAllCreatorsForTenant } from "#lib/creator";
import { listCreatorRolesForTenant } from "#lib/creator-roles";
import { sharePercentToBps } from "#lib/credit-share";
import { assertSameOrigin } from "#lib/csrf";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import {
  bulkEditEpisodeCredits,
  createEpisode,
  episodesCacheTag,
  listAllEpisodesForTenant,
  reorderEpisodePage,
} from "#lib/episode";
import type { BulkEpisodeCreditOperation } from "#lib/episode";
import {
  createSeriesFreeWindows,
  episodeFreeWindowsCacheTag,
} from "#lib/episode-free-window";
import {
  boundedIntFormSchema,
  jsonRecordIdArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalRecordId,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { toFreeWindowPeriod } from "#lib/free-window-period";
import { getMessagesFor } from "#lib/messages";
import { PURCHASE_AVAILABILITY_OVERRIDES } from "#lib/purchase-availability";
import { EPISODE_AVAILABILITY_OVERRIDES } from "#lib/surface-availability";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  BulkEditEpisodeCreditsActionState,
  EpisodeActionState,
  ListEpisodeCreditRangeCatalogResult,
} from "../episode-types";
import {
  MAX_BULK_EPISODE_CREDIT_EPISODES,
  episodesSelectedInReadingOrder,
} from "./credit-range";
import {
  MAX_SERIES_FREE_WINDOW_EPISODES,
  freeWindowEpisodes,
} from "./free-window-target";

const createEpisodeSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    // The empty value is the episode following its series.
    availability: z.enum(EPISODE_AVAILABILITY_OVERRIDES, {
      error: t("admin.series.episodes.validation.availability_invalid"),
    }),
    price: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.price_invalid")
    ),
    publishAt: optionalTrimmedString(),
    // The empty value is the episode following its series.
    purchaseAvailability: z.enum(PURCHASE_AVAILABILITY_OVERRIDES, {
      error: t(
        "admin.series.episodes.validation.purchase_availability_invalid"
      ),
    }),
    readingPeriodHours: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.reading_period_invalid")
    ),
    seriesId: requiredRecordId(
      t("admin.series.episodes.validation.series_missing")
    ),
    seriesPublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
    title: requiredTrimmedString(
      t("admin.series.episodes.validation.title_required")
    ),
  });
};
const reorderEpisodesSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    currentEpisodeIds: jsonRecordIdArrayFormSchema,
    orderedEpisodeIds: jsonRecordIdArrayFormSchema,
    seriesId: requiredRecordId(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
  });
};
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
  locale: Locale
): Promise<
  { ok: true; value: string } | ReturnType<typeof toCreateFailure>
> => {
  if (!publishAtRaw) {
    return { ok: true, value: "" };
  }

  // The form posts an absolute instant resolved against the zone it was
  // rendered in. A leftover `datetime-local` wall clock (no JS) is still
  // accepted and read in the tenant's current display zone.
  const [t, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const value = toInstantIsoString(publishAtRaw, timeZone);
  const parsed = parseInstant(value);
  if (!parsed) {
    return toCreateFailure(
      t("admin.series.episodes.validation.publish_at_invalid")
    );
  }

  // A time that has already passed publishes the episode as it is created.
  return { ok: true, value };
};

export const createEpisodeAction = async (
  _prevState: EpisodeActionState,
  formData: FormData
): Promise<EpisodeActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await createEpisodeSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      availability: "value",
      price: "value",
      publishAt: { kind: "value", name: "publish_at" },
      purchaseAvailability: { kind: "value", name: "purchase_availability" },
      readingPeriodHours: { kind: "value", name: "reading_period_hours" },
      seriesId: { kind: "value", name: "series_id" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
      tenantId: { kind: "value", name: "tenant_id" },
      title: "value",
    })
  );
  if (!parsed.success) {
    return toCreateFailure(toFormErrorMessage(parsed.error, { locale }));
  }

  const scheduledAt = await toScheduledAt(
    parsed.data.publishAt,
    parsed.data.tenantId,
    locale
  );
  if (!scheduledAt.ok) {
    return scheduledAt;
  }

  // `orderIndex` is not sent. `ListEpisodes` returns one page at a time, so
  // counting the end by reading every episode is no longer possible; the
  // server decides where an appended episode lands.
  const result = await withAdminSessionReauth(() =>
    createEpisode(
      {
        availability: parsed.data.availability,
        price: parsed.data.price,
        publishAt: scheduledAt.value,
        purchaseAvailability: parsed.data.purchaseAvailability,
        readingPeriodHours: parsed.data.readingPeriodHours,
        seriesId: parsed.data.seriesId,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return toCreateFailure(result.message);
  }

  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(tenantDashboardCacheTag(parsed.data.tenantId));

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${result.episode.publicId}?created=1`
  );
};

export const reorderEpisodesAction = async (formData: FormData) => {
  "use server";

  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    reorderEpisodesSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currentEpisodeIds: { kind: "value", name: "current_episode_ids" },
      orderedEpisodeIds: { kind: "value", name: "ordered_episode_ids" },
      seriesId: { kind: "value", name: "series_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, {
        fallback: t("admin.series.episodes.validation.sort_data_missing"),
        locale,
      }),
      ok: false,
    };
  }

  if (parsed.data.orderedEpisodeIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_episodes_to_sort"),
      ok: false,
    };
  }

  if (
    parsed.data.currentEpisodeIds.length !==
    parsed.data.orderedEpisodeIds.length
  ) {
    return {
      message: t("admin.series.episodes.validation.sort_data_missing"),
      ok: false,
    };
  }

  // The list screen posts the order of the page that was dragged on, not of the
  // whole series; the merge back into the series' order happens in the lib.
  const reordered = await withAdminSessionReauth(() =>
    reorderEpisodePage(
      {
        currentEpisodeIds: parsed.data.currentEpisodeIds,
        episodeIds: parsed.data.orderedEpisodeIds,
        seriesId: parsed.data.seriesId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!reordered.ok) {
    return reordered;
  }

  updateTag(episodesCacheTag(parsed.data.tenantId));

  return {
    ok: true,
  };
};

const BULK_CREDIT_OPERATIONS = [
  "add",
  "replace",
  "remove",
  "set_share",
] as const;

type BulkCreditOperationType = (typeof BULK_CREDIT_OPERATIONS)[number];

const isBulkCreditOperationType = (
  value: string
): value is BulkCreditOperationType =>
  BULK_CREDIT_OPERATIONS.some((operation) => operation === value);

const bulkEditEpisodeCreditsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      creatorId: optionalRecordId(),
      episodeIds: jsonRecordIdArrayFormSchema,
      fromCreatorId: optionalRecordId(),
      fromRoleId: optionalRecordId(),
      operation: requiredTrimmedString(
        t("admin.series.episodes.credits.validation.operation_required")
      ),
      roleId: optionalRecordId(),
      seriesId: requiredRecordId(
        t("admin.series.episodes.validation.series_missing")
      ),
      share: optionalTrimmedString(),
      tenantId: requiredTrimmedString(
        t("admin.series.episodes.validation.tenant_missing")
      ),
      toCreatorId: optionalRecordId(),
      toRoleId: optionalRecordId(),
    })
    .superRefine((value, ctx) => {
      if (!isBulkCreditOperationType(value.operation)) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.series.episodes.credits.validation.operation_required"
          ),
          path: ["operation"],
        });
        return;
      }

      if (value.operation === "replace") {
        if (
          value.fromCreatorId.length === 0 ||
          value.fromRoleId.length === 0 ||
          value.toCreatorId.length === 0 ||
          value.toRoleId.length === 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.series.episodes.credits.validation.credit_required"
            ),
            path: ["fromCreatorId"],
          });
        }
        if (
          value.fromCreatorId === value.toCreatorId &&
          value.fromRoleId === value.toRoleId &&
          value.fromCreatorId.length > 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.series.episodes.credits.validation.replace_same"),
            path: ["toCreatorId"],
          });
        }
        return;
      }

      if (value.creatorId.length === 0 || value.roleId.length === 0) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.series.episodes.credits.validation.credit_required"
          ),
          path: ["creatorId"],
        });
      }
      // An empty box names no share to set, so set-share needs a value.
      if (
        value.operation === "set_share" &&
        (value.share.length === 0 ||
          sharePercentToBps(value.share) === undefined)
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.series.episodes.credits.validation.share_invalid"),
          path: ["share"],
        });
      }
    });
};

const toBulkCreditOperation = (
  parsed: z.output<Awaited<ReturnType<typeof bulkEditEpisodeCreditsSchema>>>
): BulkEpisodeCreditOperation | undefined => {
  if (!isBulkCreditOperationType(parsed.operation)) {
    return undefined;
  }
  if (parsed.operation === "replace") {
    return {
      from: {
        creatorId: parsed.fromCreatorId,
        roleId: parsed.fromRoleId,
      },
      to: {
        creatorId: parsed.toCreatorId,
        roleId: parsed.toRoleId,
      },
      type: "replace",
    };
  }
  if (parsed.creatorId.length === 0 || parsed.roleId.length === 0) {
    return undefined;
  }
  const credit = {
    creatorId: parsed.creatorId,
    roleId: parsed.roleId,
  };
  if (parsed.operation === "set_share") {
    const shareBps = sharePercentToBps(parsed.share);
    return shareBps === undefined
      ? undefined
      : { credit, shareBps, type: "set_share" };
  }
  return { credit, type: parsed.operation };
};

const listEpisodeCreditRangeOptionsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    seriesId: requiredRecordId(
      t("admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
  });
};

export const listEpisodeCreditRangeOptionsAction = async (
  tenantId: string,
  seriesId: string,
  locale: Locale
): Promise<ListEpisodeCreditRangeCatalogResult> => {
  const schema = await listEpisodeCreditRangeOptionsSchema(locale);
  const parsed = schema.safeParse({
    seriesId,
    tenantId,
  });
  if (!parsed.success) {
    const message = toFormErrorMessage(parsed.error, { locale });
    return {
      creatorRoles: [],
      creators: [],
      episodes: [],
      episodesErrorMessage: message,
    };
  }

  // The tenant comes from the client and these lists are read with the
  // service credential, which answers for any tenant.
  await verifyAdminSession(parsed.data.tenantId);
  const [episodesResult, creatorsResult, creatorRolesResult] =
    await Promise.all([
      listAllEpisodesForTenant(
        { seriesId: parsed.data.seriesId, tenantId: parsed.data.tenantId },
        locale
      ),
      listAllCreatorsForTenant(parsed.data.tenantId, locale),
      listCreatorRolesForTenant(parsed.data.tenantId, locale),
    ]);

  return {
    creatorRoles: creatorRolesResult.creatorRoles,
    creatorRolesErrorMessage: creatorRolesResult.ok
      ? undefined
      : creatorRolesResult.message,
    creators: creatorsResult.creators.map((creator) => ({
      id: creator.id,
      name: creator.name,
    })),
    creatorsErrorMessage: creatorsResult.ok
      ? undefined
      : creatorsResult.message,
    episodes: episodesResult.ok
      ? episodesResult.episodes.map((episode) => ({
          id: episode.id,
          publicId: episode.publicId,
          title: episode.title,
        }))
      : [],
    episodesErrorMessage: episodesResult.ok
      ? undefined
      : episodesResult.message,
  };
};

export const bulkEditEpisodeCreditsAction = async (
  _prevState: BulkEditEpisodeCreditsActionState,
  formData: FormData
): Promise<BulkEditEpisodeCreditsActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    bulkEditEpisodeCreditsSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      creatorId: { kind: "value", name: "creator_id" },
      episodeIds: { kind: "value", name: "episode_ids" },
      fromCreatorId: { kind: "value", name: "from_creator_id" },
      fromRoleId: { kind: "value", name: "from_role_id" },
      operation: "value",
      roleId: { kind: "value", name: "role_id" },
      seriesId: { kind: "value", name: "series_id" },
      share: "value",
      tenantId: { kind: "value", name: "tenant_id" },
      toCreatorId: { kind: "value", name: "to_creator_id" },
      toRoleId: { kind: "value", name: "to_role_id" },
    })
  );
  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const operation = toBulkCreditOperation(parsed.data);
  if (!operation) {
    return {
      message: t("admin.series.episodes.credits.validation.credit_required"),
      ok: false,
    };
  }

  await verifyAdminSession(parsed.data.tenantId);
  const listed = await listAllEpisodesForTenant(
    { seriesId: parsed.data.seriesId, tenantId: parsed.data.tenantId },
    locale
  );
  if (!listed.ok) {
    return {
      message: listed.message,
      ok: false,
    };
  }

  const selected = episodesSelectedInReadingOrder(
    listed.episodes,
    parsed.data.episodeIds
  );
  if (selected.length === 0) {
    return {
      message: t("admin.series.episodes.credits.validation.selection_required"),
      ok: false,
    };
  }
  if (selected.length > MAX_BULK_EPISODE_CREDIT_EPISODES) {
    return {
      message: t("admin.series.episodes.credits.selection_too_many", {
        count: String(MAX_BULK_EPISODE_CREDIT_EPISODES),
      }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    bulkEditEpisodeCredits(
      {
        episodeIds: selected.map((episode) => episode.id),
        operation,
        seriesId: parsed.data.seriesId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (result.ok) {
    updateTag(episodesCacheTag(parsed.data.tenantId));
  }
  return result;
};

const createSeriesFreeWindowsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const base = {
    endsAt: optionalTrimmedString(),
    seriesId: requiredRecordId(
      t("admin.series.episodes.validation.series_missing")
    ),
    startsAt: optionalTrimmedString(),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
  };

  return z.discriminatedUnion(
    "target",
    [
      z.object({
        ...base,
        episodeIds: jsonRecordIdArrayFormSchema,
        target: z.literal("selected"),
      }),
      z.object({
        ...base,
        firstCount: boundedIntFormSchema(
          t(
            "admin.series.episodes.free_windows.validation.first_count_invalid",
            { max: String(MAX_SERIES_FREE_WINDOW_EPISODES) }
          ),
          { max: MAX_SERIES_FREE_WINDOW_EPISODES, min: 1 }
        ),
        target: z.literal("first"),
      }),
      z.object({ ...base, target: z.literal("all") }),
    ],
    {
      error: t("admin.series.episodes.free_windows.validation.target_invalid"),
    }
  );
};

/**
 * The free reading period action on the series episode list: one period on
 * the checked episodes, on the first ones, or on all of them, in one
 * all-or-nothing call. The windows show on each episode's screen rather than
 * on the list, so success is a message rather than a refresh.
 */
export const createSeriesFreeWindowsAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    createSeriesFreeWindowsSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      endsAt: { kind: "value", name: "ends_at" },
      episodeIds: { kind: "value", name: "episode_ids" },
      firstCount: { kind: "value", name: "first_count" },
      seriesId: { kind: "value", name: "series_id" },
      startsAt: { kind: "value", name: "starts_at" },
      target: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { seriesId, tenantId } = parsed.data;
  const period = await toFreeWindowPeriod(
    parsed.data,
    await getTenantDisplayTimeZone(tenantId),
    locale
  );
  if (!period.ok) {
    return period;
  }

  await verifyAdminSession(tenantId);
  const listed = await listAllEpisodesForTenant({ seriesId, tenantId }, locale);
  if (!listed.ok) {
    return { message: listed.message, ok: false };
  }

  const covered = freeWindowEpisodes(listed.episodes, parsed.data);
  if (!covered.ok) {
    if (covered.reason === "too-many") {
      return {
        message: t(
          "admin.series.episodes.free_windows.validation.selection_too_many",
          { count: String(MAX_SERIES_FREE_WINDOW_EPISODES) }
        ),
        ok: false,
      };
    }
    return {
      message:
        parsed.data.target === "selected"
          ? t("admin.series.episodes.free_windows.validation.selection_empty")
          : t("admin.series.episodes.free_windows.no_episodes"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    createSeriesFreeWindows(
      {
        endsAt: period.endsAt,
        episodeIds: covered.episodeIds,
        seriesId,
        startsAt: period.startsAt,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodeFreeWindowsCacheTag(tenantId));
  return {
    message: t("admin.series.episodes.free_windows.bulk_created", {
      count: String(result.freeWindows.length),
    }),
    ok: true,
  };
};
