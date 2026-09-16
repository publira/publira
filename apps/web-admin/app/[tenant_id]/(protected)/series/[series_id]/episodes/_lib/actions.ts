"use server";

import type { Locale } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import {
  redirectToLoginIfSessionRejected,
  withAdminSessionReauth,
} from "#lib/auth-session";
import { listAllCreators } from "#lib/creator";
import { listCreatorRoles } from "#lib/creator-roles";
import { assertSameOrigin } from "#lib/csrf";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import {
  bulkEditEpisodeCredits,
  createEpisode,
  listAllEpisodes,
  reorderEpisodePage,
} from "#lib/episode";
import type { BulkEpisodeCreditOperation } from "#lib/episode";
import {
  jsonStringArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
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

const createEpisodeSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    price: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.price_invalid")
    ),
    publishAt: optionalTrimmedString(),
    readingPeriodHours: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.reading_period_invalid")
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
    currentEpisodeIds: jsonStringArrayFormSchema,
    orderedEpisodeIds: jsonStringArrayFormSchema,
    seriesPublicId: requiredTrimmedString(
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

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toCreateFailure(
      t("admin.series.episodes.validation.publish_at_future")
    );
  }

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
      price: "value",
      publishAt: { kind: "value", name: "publish_at" },
      readingPeriodHours: { kind: "value", name: "reading_period_hours" },
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
        price: parsed.data.price,
        publishAt: scheduledAt.value,
        readingPeriodHours: parsed.data.readingPeriodHours,
        seriesPublicId: parsed.data.seriesPublicId,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return toCreateFailure(result.message);
  }

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
      currentEpisodeIds: { kind: "value", name: "current_episode_public_ids" },
      orderedEpisodeIds: { kind: "value", name: "ordered_episode_public_ids" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
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
        currentEpisodePublicIds: parsed.data.currentEpisodeIds,
        episodePublicIds: parsed.data.orderedEpisodeIds,
        seriesPublicId: parsed.data.seriesPublicId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!reordered.ok) {
    return reordered;
  }

  return {
    ok: true,
  };
};

const BULK_CREDIT_OPERATIONS = ["add", "replace", "remove"] as const;

type BulkCreditOperationType = (typeof BULK_CREDIT_OPERATIONS)[number];

const isBulkCreditOperationType = (
  value: string
): value is BulkCreditOperationType =>
  BULK_CREDIT_OPERATIONS.some((operation) => operation === value);

const bulkEditEpisodeCreditsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      creatorPublicId: optionalTrimmedString(),
      episodePublicIds: jsonStringArrayFormSchema,
      fromCreatorPublicId: optionalTrimmedString(),
      fromRolePublicId: optionalTrimmedString(),
      operation: requiredTrimmedString(
        t("admin.series.episodes.credits.validation.operation_required")
      ),
      rolePublicId: optionalTrimmedString(),
      seriesPublicId: requiredTrimmedString(
        t("admin.series.episodes.validation.series_missing")
      ),
      tenantId: requiredTrimmedString(
        t("admin.series.episodes.validation.tenant_missing")
      ),
      toCreatorPublicId: optionalTrimmedString(),
      toRolePublicId: optionalTrimmedString(),
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
          value.fromCreatorPublicId.length === 0 ||
          value.fromRolePublicId.length === 0 ||
          value.toCreatorPublicId.length === 0 ||
          value.toRolePublicId.length === 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.series.episodes.credits.validation.credit_required"
            ),
            path: ["fromCreatorPublicId"],
          });
        }
        if (
          value.fromCreatorPublicId === value.toCreatorPublicId &&
          value.fromRolePublicId === value.toRolePublicId &&
          value.fromCreatorPublicId.length > 0
        ) {
          ctx.addIssue({
            code: "custom",
            message: t("admin.series.episodes.credits.validation.replace_same"),
            path: ["toCreatorPublicId"],
          });
        }
        return;
      }

      if (
        value.creatorPublicId.length === 0 ||
        value.rolePublicId.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.series.episodes.credits.validation.credit_required"
          ),
          path: ["creatorPublicId"],
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
        creatorPublicId: parsed.fromCreatorPublicId,
        rolePublicId: parsed.fromRolePublicId,
      },
      to: {
        creatorPublicId: parsed.toCreatorPublicId,
        rolePublicId: parsed.toRolePublicId,
      },
      type: "replace",
    };
  }
  if (parsed.creatorPublicId.length === 0 || parsed.rolePublicId.length === 0) {
    return undefined;
  }
  return {
    credit: {
      creatorPublicId: parsed.creatorPublicId,
      rolePublicId: parsed.rolePublicId,
    },
    type: parsed.operation,
  };
};

const listEpisodeCreditRangeOptionsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    seriesPublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
  });
};

export const listEpisodeCreditRangeOptionsAction = async (
  tenantId: string,
  seriesPublicId: string,
  locale: Locale
): Promise<ListEpisodeCreditRangeCatalogResult> => {
  const schema = await listEpisodeCreditRangeOptionsSchema(locale);
  const parsed = schema.safeParse({
    seriesPublicId,
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

  const [episodesResult, creatorsResult, creatorRolesResult] =
    await Promise.all([
      listAllEpisodes(
        {
          seriesPublicId: parsed.data.seriesPublicId,
          tenantId: parsed.data.tenantId,
        },
        locale
      ),
      listAllCreators(parsed.data.tenantId, locale),
      listCreatorRoles(parsed.data.tenantId, locale),
    ]);
  await redirectToLoginIfSessionRejected(
    episodesResult,
    creatorsResult,
    creatorRolesResult
  );

  return {
    creatorRoles: creatorRolesResult.creatorRoles,
    creatorRolesErrorMessage: creatorRolesResult.ok
      ? undefined
      : creatorRolesResult.message,
    creators: creatorsResult.creators.map((creator) => ({
      name: creator.name,
      publicId: creator.publicId,
    })),
    creatorsErrorMessage: creatorsResult.ok
      ? undefined
      : creatorsResult.message,
    episodes: episodesResult.ok
      ? episodesResult.episodes.map((episode) => ({
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
      creatorPublicId: { kind: "value", name: "creator_public_id" },
      episodePublicIds: { kind: "value", name: "episode_public_ids" },
      fromCreatorPublicId: { kind: "value", name: "from_creator_public_id" },
      fromRolePublicId: { kind: "value", name: "from_role_public_id" },
      operation: "value",
      rolePublicId: { kind: "value", name: "role_public_id" },
      seriesPublicId: { kind: "value", name: "series_public_id" },
      tenantId: { kind: "value", name: "tenant_id" },
      toCreatorPublicId: { kind: "value", name: "to_creator_public_id" },
      toRolePublicId: { kind: "value", name: "to_role_public_id" },
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

  const listed = await listAllEpisodes(
    {
      seriesPublicId: parsed.data.seriesPublicId,
      tenantId: parsed.data.tenantId,
    },
    locale
  );
  await redirectToLoginIfSessionRejected(listed);
  if (!listed.ok) {
    return {
      message: listed.message,
      ok: false,
    };
  }

  const selected = episodesSelectedInReadingOrder(
    listed.episodes,
    parsed.data.episodePublicIds
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

  return await withAdminSessionReauth(() =>
    bulkEditEpisodeCredits(
      {
        episodePublicIds: selected.map((episode) => episode.publicId),
        operation,
        seriesPublicId: parsed.data.seriesPublicId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
};
