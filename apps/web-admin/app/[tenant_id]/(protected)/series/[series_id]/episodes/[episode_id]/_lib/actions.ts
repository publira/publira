"use server";

import type { Locale } from "@publira/i18n";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormActionState } from "#components/action-form";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import {
  episodeCacheTag,
  reorderEpisodeImages,
  updateEpisodeAvailability,
  updateEpisodeLayout,
  updateEpisodePurchaseAvailability,
  replaceEpisodeCredits,
  updateEpisodePublishSchedule,
  uploadEpisodePages,
} from "#lib/episode";
import {
  creditShareBpsSchema,
  fileListFormSchema,
  jsonStringArrayFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  spreadStartPageFormSchema,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { PURCHASE_AVAILABILITY_OVERRIDES } from "#lib/purchase-availability";
import { READING_DIRECTIONS } from "#lib/reading-layout";
import { EPISODE_AVAILABILITY_OVERRIDES } from "#lib/surface-availability";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  EpisodeEditActionState,
  EpisodeEditMode,
} from "../episode-edit-types";

const hiddenParamsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    episodePublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.episode_missing")
    ),
    seriesPublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.series_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
  });
};
const scheduleFormSchema = async (locale: Locale) => {
  const base = await hiddenParamsSchema(locale);

  return base.extend({
    publishAt: optionalTrimmedString(),
  });
};
const creditsFormSchema = async (locale: Locale) => {
  const [base, t] = await Promise.all([
    hiddenParamsSchema(locale),
    getMessagesFor(locale),
  ]);
  const message = t("admin.series.episodes.validation.creator_credits_invalid");
  return base.extend({
    creatorCredits: z.preprocess(
      (value) => {
        if (typeof value !== "string" || value.trim() === "") {
          return [];
        }
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      },
      z.array(
        z.object({
          creatorPublicId: requiredTrimmedString(message),
          rolePublicId: requiredTrimmedString(message),
          shareBps: creditShareBpsSchema(message),
        }),
        { error: message }
      )
    ),
  });
};
const uploadModeSchema = z.preprocess(
  (value) => {
    if (value === "zip" || value === "epub" || value === "pages") {
      return value;
    }

    return "pages";
  },
  z.enum(["pages", "zip", "epub"])
);

const uploadPagesFormSchema = async (locale: Locale) => {
  const base = await hiddenParamsSchema(locale);

  return base.extend({
    archive: optionalFileFormSchema,
    pages: fileListFormSchema,
    uploadMode: uploadModeSchema,
  });
};
const reorderImagesSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    episodePublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
    orderedImageIds: jsonStringArrayFormSchema,
    seriesPublicId: requiredTrimmedString(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
  });
};
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
  tenantId: string,
  locale: Locale
): Promise<{ ok: true; iso: string } | ReturnType<typeof toFailure>> => {
  if (!value) {
    return { iso: "", ok: true };
  }

  // The form posts an absolute instant resolved against the zone it was
  // rendered in. A leftover `datetime-local` wall clock (no JS) is still
  // accepted and read in the tenant's current display zone.
  const [t, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const iso = toInstantIsoString(value, timeZone);
  const parsed = parseInstant(iso);
  if (!parsed) {
    return toFailure(
      t("admin.series.episodes.validation.publish_at_invalid"),
      "schedule"
    );
  }

  if (Temporal.Instant.compare(parsed, Temporal.Now.instant()) <= 0) {
    return toFailure(
      t("admin.series.episodes.validation.publish_at_future"),
      "schedule"
    );
  }

  return { iso, ok: true };
};

export const updateEpisodeScheduleAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await scheduleFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      publishAt: { kind: "value", name: "publish_at" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "schedule");
  }

  const schedule = await parsePublishAtToRFC3339(
    parsed.data.publishAt,
    parsed.data.tenantId,
    locale
  );
  if (!schedule.ok) {
    return schedule;
  }

  const result = await withAdminSessionReauth(() =>
    updateEpisodePublishSchedule(
      {
        episodePublicId: parsed.data.episodePublicId,
        publishAt: schedule.iso,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "schedule");
  }

  updateTag(tenantDashboardCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodePublicId));

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?schedule_updated=1`
  );
};

const availabilityFormSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    hiddenParamsSchema(locale),
  ]);

  return base.extend({
    // The empty value is the episode following its series.
    availability: z.enum(EPISODE_AVAILABILITY_OVERRIDES, {
      error: t("admin.series.episodes.validation.availability_invalid"),
    }),
  });
};

export const updateEpisodeAvailabilityAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await availabilityFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      availability: "value",
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { availability, episodePublicId, seriesPublicId, tenantId } =
    parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateEpisodeAvailability(
      { availability, episodePublicId, tenantId },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodeCacheTag(tenantId, episodePublicId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?availability_updated=1`
  );
};

const purchaseAvailabilityFormSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    hiddenParamsSchema(locale),
  ]);

  return base.extend({
    // The empty value is the episode following its series.
    purchaseAvailability: z.enum(PURCHASE_AVAILABILITY_OVERRIDES, {
      error: t(
        "admin.series.episodes.validation.purchase_availability_invalid"
      ),
    }),
  });
};

export const updateEpisodePurchaseAvailabilityAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await purchaseAvailabilityFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      purchaseAvailability: { kind: "value", name: "purchase_availability" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { episodePublicId, purchaseAvailability, seriesPublicId, tenantId } =
    parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateEpisodePurchaseAvailability(
      { episodePublicId, purchaseAvailability, tenantId },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodeCacheTag(tenantId, episodePublicId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?purchase_availability_updated=1`
  );
};

const layoutFormSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    hiddenParamsSchema(locale),
  ]);
  const spreadStartInvalid = t(
    "admin.series.episodes.validation.spread_start_invalid"
  );

  return base.extend({
    // The empty value is the episode following its series.
    readingDirection: z.enum(["", ...READING_DIRECTIONS], {
      error: t("admin.series.episodes.validation.reading_direction_invalid"),
    }),
    spreadStart: z.discriminatedUnion(
      "source",
      [
        z.object({ source: z.literal("series") }),
        z.object({
          page: spreadStartPageFormSchema(spreadStartInvalid),
          source: z.literal("episode"),
        }),
      ],
      { error: spreadStartInvalid }
    ),
  });
};

export const updateEpisodeLayoutAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await layoutFormSchema(locale);
  const input = toFormDataInput(formData, {
    ...hiddenFormFields,
    readingDirection: { kind: "value", name: "reading_direction" },
    spreadStartPage: { kind: "value", name: "spread_start_page" },
    spreadStartSource: { kind: "value", name: "spread_start_source" },
  });
  const parsed = schema.safeParse({
    ...input,
    spreadStart: {
      page: input.spreadStartPage,
      source: input.spreadStartSource,
    },
  });
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { episodePublicId, readingDirection, seriesPublicId, spreadStart } =
    parsed.data;
  const result = await withAdminSessionReauth(() =>
    updateEpisodeLayout(
      {
        episodePublicId,
        readingDirection,
        spreadStartIndex:
          spreadStart.source === "episode" ? spreadStart.page : undefined,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodeCacheTag(parsed.data.tenantId, episodePublicId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?layout_updated=1`
  );
};

export const replaceEpisodeCreditsAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await creditsFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      creatorCredits: { kind: "value", name: "creator_credits" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "credits");
  }
  const result = await withAdminSessionReauth(() =>
    replaceEpisodeCredits(
      {
        creatorCredits: parsed.data.creatorCredits,
        episodePublicId: parsed.data.episodePublicId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return toFailure(result.message, "credits");
  }
  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?credits_updated=1`
  );
};

export const uploadEpisodePagesAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    uploadPagesFormSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      archive: { kind: "file", name: "archive" },
      pages: { kind: "files", name: "pages" },
      uploadMode: { kind: "value", name: "upload_mode" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "pages");
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
          ? t("admin.series.episodes.validation.zip_required")
          : t("admin.series.episodes.validation.epub_required"),
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
          ? t("admin.series.episodes.validation.zip_invalid")
          : t("admin.series.episodes.validation.epub_invalid"),
        "pages"
      );
    }

    const result = await withAdminSessionReauth(() =>
      uploadEpisodePages(
        {
          archive,
          episodePublicId,
          seriesPublicId,
          tenantId,
        },
        locale
      )
    );

    if (!result.ok) {
      return toFailure(result.message, "pages");
    }

    updateTag(episodeCacheTag(tenantId, episodePublicId));

    redirect(
      `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
    );
  }

  if (pages.length === 0) {
    return toFailure(
      t("admin.series.episodes.validation.pages_required"),
      "pages"
    );
  }

  const result = await withAdminSessionReauth(() =>
    uploadEpisodePages(
      {
        episodePublicId,
        pages,
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "pages");
  }

  updateTag(episodeCacheTag(tenantId, episodePublicId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?pages_uploaded=1`
  );
};

export const reorderEpisodeImagesAction = async (formData: FormData) => {
  "use server";

  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    reorderImagesSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      orderedImageIds: { kind: "value", name: "ordered_image_ids" },
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

  if (parsed.data.orderedImageIds.length === 0) {
    return {
      message: t("admin.series.episodes.validation.no_images_to_sort"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    reorderEpisodeImages(
      {
        episodePublicId: parsed.data.episodePublicId,
        imageIds: parsed.data.orderedImageIds,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return result;
  }

  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodePublicId));

  return {
    ok: true,
  };
};
