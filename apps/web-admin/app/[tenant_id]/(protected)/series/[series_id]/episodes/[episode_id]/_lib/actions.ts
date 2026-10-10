"use server";

import type { Locale } from "@publira/i18n";
import type { FormActionState } from "@publira/ui-components/action-form";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { accessTicketsCacheTag } from "#lib/access-ticket";
import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import {
  deleteEpisodeImage,
  episodeCacheTag,
  episodesCacheTag,
  getEpisodeForTenant,
  reorderEpisodeImages,
  updateEpisodeAvailability,
  updateEpisodeLayout,
  updateEpisodePricing,
  updateEpisodePurchaseAvailability,
  replaceEpisodeCredits,
  updateEpisodePublishSchedule,
  updateEpisodeTitle,
} from "#lib/episode";
import {
  createEpisodeFreeWindow,
  deleteEpisodeFreeWindow,
  episodeFreeWindowsCacheTag,
} from "#lib/episode-free-window";
import {
  creditShareBpsSchema,
  jsonStringArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
  spreadStartPageFormSchema,
} from "#lib/form-schemas";
import { toFreeWindowPeriod } from "#lib/free-window-period";
import { getMessagesFor } from "#lib/messages";
import { PURCHASE_AVAILABILITY_OVERRIDES } from "#lib/purchase-availability";
import { READING_DIRECTIONS } from "#lib/reading-layout";
import { EPISODE_AVAILABILITY_OVERRIDES } from "#lib/surface-availability";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type { EpisodeEditActionState } from "../episode-edit-types";

const hiddenParamsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    episodeId: requiredRecordId(
      t("admin.series.episodes.validation.episode_missing")
    ),
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
const freeWindowFormSchema = async (locale: Locale) => {
  const base = await hiddenParamsSchema(locale);

  return base.extend({
    endsAt: optionalTrimmedString(),
    startsAt: optionalTrimmedString(),
  });
};
const deleteFreeWindowSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);
  const missing = t(
    "admin.series.episodes.free_windows.validation.free_window_missing"
  );

  return z.object({
    freeWindowId: requiredRecordId(missing),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
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
          creatorId: requiredRecordId(message),
          roleId: requiredRecordId(message),
          shareBps: creditShareBpsSchema(message),
        }),
        { error: message }
      )
    ),
  });
};
const reorderImagesSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    episodeId: requiredRecordId(
      t("admin.series.episodes.validation.sort_data_missing")
    ),
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
  episodeId: { kind: "value", name: "episode_id" },
  episodePublicId: { kind: "value", name: "episode_public_id" },
  seriesPublicId: { kind: "value", name: "series_public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/**
 * Refuses a save whose URL-named episode is not the one its internal ID
 * addresses: the save acts on the ID and redirects to the URL, so a mismatched
 * pair would change one episode and show another.
 */
const confirmEpisodeTarget = async (
  target: {
    episodeId: string;
    episodePublicId: string;
    seriesPublicId: string;
    tenantId: string;
  },
  locale: Locale
): Promise<string | undefined> => {
  await verifyAdminSession(target.tenantId);
  const result = await getEpisodeForTenant(
    {
      publicId: target.episodePublicId,
      seriesPublicId: target.seriesPublicId,
      tenantId: target.tenantId,
    },
    locale
  );
  if (result.ok && result.episode.id === target.episodeId) {
    return;
  }
  if (!result.ok && "message" in result && result.message) {
    return result.message;
  }
  const t = await getMessagesFor(locale);
  return t("admin.series.episodes.validation.episode_missing");
};

const toFailure = (message: string): { message: string; ok: false } => ({
  message,
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
    return toFailure(t("admin.series.episodes.validation.publish_at_invalid"));
  }

  // A time that has passed is sent as it is: the API publishes a draft or a
  // scheduled episode at once and leaves a published one as it is, so saving
  // the time a published episode went out with changes nothing.
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
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }

  const schedule = await parsePublishAtToRFC3339(
    parsed.data.publishAt,
    parsed.data.tenantId,
    locale
  );
  if (!schedule.ok) {
    return schedule;
  }

  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return toFailure(mismatch);
  }

  const result = await withAdminSessionReauth(() =>
    updateEpisodePublishSchedule(
      {
        episodeId: parsed.data.episodeId,
        publishAt: schedule.iso,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message);
  }

  updateTag(tenantDashboardCacheTag(parsed.data.tenantId));
  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodeId));

  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?schedule_updated=1`
  );
};

const titleFormSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    hiddenParamsSchema(locale),
  ]);

  return base.extend({
    title: requiredTrimmedString(
      t("admin.series.episodes.validation.title_required")
    ),
  });
};

export const updateEpisodeTitleAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await titleFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      title: "value",
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { episodeId, episodePublicId, seriesPublicId, tenantId, title } =
    parsed.data;
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return { message: mismatch, ok: false };
  }
  const result = await withAdminSessionReauth(() =>
    updateEpisodeTitle({ episodeId, tenantId, title }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodesCacheTag(tenantId));
  updateTag(episodeCacheTag(tenantId, episodeId));
  updateTag(accessTicketsCacheTag(tenantId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?title_updated=1`
  );
};

const pricingFormSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    hiddenParamsSchema(locale),
  ]);

  return base.extend({
    price: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.price_invalid")
    ),
    readingPeriodHours: nonNegativeIntFormSchema(
      t("admin.series.episodes.validation.reading_period_invalid")
    ),
  });
};

export const updateEpisodePricingAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await pricingFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      price: "value",
      readingPeriodHours: { kind: "value", name: "reading_period_hours" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const {
    episodeId,
    episodePublicId,
    price,
    readingPeriodHours,
    seriesPublicId,
    tenantId,
  } = parsed.data;
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return { message: mismatch, ok: false };
  }
  const result = await withAdminSessionReauth(() =>
    updateEpisodePricing(
      { episodeId, price, readingPeriodHours, tenantId },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodesCacheTag(tenantId));
  updateTag(episodeCacheTag(tenantId, episodeId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?pricing_updated=1`
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

  const { availability, episodeId, episodePublicId, seriesPublicId, tenantId } =
    parsed.data;
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return { message: mismatch, ok: false };
  }
  const result = await withAdminSessionReauth(() =>
    updateEpisodeAvailability({ availability, episodeId, tenantId }, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodesCacheTag(tenantId));
  updateTag(episodeCacheTag(tenantId, episodeId));

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

  const {
    episodeId,
    episodePublicId,
    purchaseAvailability,
    seriesPublicId,
    tenantId,
  } = parsed.data;
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return { message: mismatch, ok: false };
  }
  const result = await withAdminSessionReauth(() =>
    updateEpisodePurchaseAvailability(
      { episodeId, purchaseAvailability, tenantId },
      locale
    )
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(episodesCacheTag(tenantId));
  updateTag(episodeCacheTag(tenantId, episodeId));

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

  const {
    episodeId,
    episodePublicId,
    readingDirection,
    seriesPublicId,
    spreadStart,
  } = parsed.data;
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return { message: mismatch, ok: false };
  }
  const result = await withAdminSessionReauth(() =>
    updateEpisodeLayout(
      {
        episodeId,
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

  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, episodeId));

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
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }
  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return toFailure(mismatch);
  }
  const result = await withAdminSessionReauth(() =>
    replaceEpisodeCredits(
      {
        creatorCredits: parsed.data.creatorCredits,
        episodeId: parsed.data.episodeId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return toFailure(result.message);
  }
  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodeId));
  redirect(
    `/series/${parsed.data.seriesPublicId}/episodes/${parsed.data.episodePublicId}?credits_updated=1`
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
        episodeId: parsed.data.episodeId,
        imageIds: parsed.data.orderedImageIds,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return result;
  }

  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodeId));

  return {
    ok: true,
  };
};

const deleteImageSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    episodeId: requiredRecordId(
      t("admin.series.episodes.validation.episode_missing")
    ),
    imageId: requiredRecordId(
      t("admin.series.episodes.validation.image_missing")
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.episodes.validation.tenant_missing")
    ),
  });
};

export const deleteEpisodeImageAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await deleteImageSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      episodeId: { kind: "value", name: "episode_id" },
      imageId: { kind: "value", name: "image_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteEpisodeImage(parsed.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The page goes from the grid with the button in it, so success is a toast
  // rather than a message left under a form that is gone.
  updateTag(episodesCacheTag(parsed.data.tenantId));
  updateTag(episodeCacheTag(parsed.data.tenantId, parsed.data.episodeId));
  const t = await getMessagesFor(locale);
  return { message: t("admin.series.episodes.image_delete.deleted"), ok: true };
};

export const createEpisodeFreeWindowAction = async (
  _prevState: EpisodeEditActionState,
  formData: FormData
): Promise<EpisodeEditActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await freeWindowFormSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...hiddenFormFields,
      endsAt: { kind: "value", name: "ends_at" },
      startsAt: { kind: "value", name: "starts_at" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }));
  }

  const { episodeId, episodePublicId, seriesPublicId, tenantId } = parsed.data;
  const period = await toFreeWindowPeriod(
    parsed.data,
    await getTenantDisplayTimeZone(tenantId),
    locale
  );
  if (!period.ok) {
    return toFailure(period.message);
  }

  const mismatch = await confirmEpisodeTarget(parsed.data, locale);
  if (mismatch) {
    return toFailure(mismatch);
  }

  const result = await withAdminSessionReauth(() =>
    createEpisodeFreeWindow(
      {
        endsAt: period.endsAt,
        episodeId,
        startsAt: period.startsAt,
        tenantId,
      },
      locale
    )
  );
  if (!result.ok) {
    return toFailure(result.message);
  }

  updateTag(episodeFreeWindowsCacheTag(tenantId));

  redirect(
    `/series/${seriesPublicId}/episodes/${episodePublicId}?free_window_created=1`
  );
};

export const deleteEpisodeFreeWindowAction = async (
  _prevState: FormActionState,
  formData: FormData
): Promise<FormActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await deleteFreeWindowSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      freeWindowId: { kind: "value", name: "free_window_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deleteEpisodeFreeWindow(parsed.data, locale)
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The row goes from the list, so success is a toast rather than a message
  // left under a form that is gone. A window someone else deleted first leaves
  // the list too, which is why the tag is cleared on that outcome as well.
  updateTag(episodeFreeWindowsCacheTag(parsed.data.tenantId));
  const t = await getMessagesFor(locale);
  return {
    message: result.alreadyDeleted
      ? t("admin.series.episodes.free_windows.already_deleted")
      : t("admin.series.episodes.free_windows.deleted"),
    ok: true,
  };
};
