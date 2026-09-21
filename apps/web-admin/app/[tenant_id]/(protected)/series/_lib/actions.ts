"use server";

import type { Locale } from "@publira/i18n";
import { toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { EyeCatchAspectActionState } from "#components/eye-catch/types";
import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { CROP_RECT_FIELD } from "#lib/crop-rect";
import { assertSameOrigin } from "#lib/csrf";
import { tenantDashboardCacheTag } from "#lib/dashboard";
import {
  checkboxOnFormSchema,
  creditShareBpsSchema,
  flagOneFormSchema,
  nonNegativeIntFormSchema,
  optionalCropRectFormSchema,
  optionalFileFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
  spreadStartPageFormSchema,
  trimmedStringListFormSchema,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import { READING_DIRECTIONS } from "#lib/reading-layout";
import {
  createSeries,
  seriesCacheTag,
  seriesListCacheTag,
  updateSeries,
  uploadSeriesEyeCatchAspectImage,
} from "#lib/series";
import {
  MAX_SERIES_TAGS,
  SERIES_AGE_RATING_VALUES,
  SERIES_STATUS_VALUES,
} from "#lib/series-classification";
import { SERIES_COMMENT_MODES } from "#lib/series-comment-mode";
import { SURFACE_AVAILABILITIES } from "#lib/surface-availability";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  SeriesActionState,
  SeriesCreatorCredit,
  SeriesMutationMode,
} from "../series-types";

/**
 * A weekday as the form posts it: one decimal digit, 0 (Sunday) to 6. Anything
 * else is dropped rather than coerced — `Number("")` is 0, which would put
 * Sunday on a schedule nobody chose.
 */
const WEEKDAY_VALUE_RE = /^[0-6]$/u;

/**
 * The credit list, as the form posts it: one hidden JSON field holding the
 * whole list. The pair of ids is the identity of a credit, and two repeated
 * fields would arrive as two lists to zip back together — an entry missing from
 * either one would shift every credit after it onto somebody else's role.
 *
 * A payload that is not that list fails the save rather than being compacted
 * into the part that parsed, because the request replaces every credit the
 * series holds: dropping a row here would un-credit the person in it.
 */
const creatorCreditListFormSchema = (
  message: string
): z.ZodType<SeriesCreatorCredit[], unknown> =>
  z.preprocess(
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
  );

const scheduleWeekdaysFormSchema = z
  .array(z.string())
  .transform((values) =>
    [
      ...new Set(
        values.flatMap((value) =>
          WEEKDAY_VALUE_RE.test(value.trim()) ? [Number(value.trim())] : []
        )
      ),
    ].toSorted((a, b) => a - b)
  );

/**
 * `published_at` arrives either as an absolute timestamp (the form resolves
 * the wall clock against the zone it was rendered in) or as a leftover
 * zone-less `datetime-local` value. The latter is read in the tenant's
 * current display zone rather than being glued to a hardcoded `+09:00` or
 * reinterpreted in the server's local zone.
 */
const seriesCommonSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    ageRating: z.enum(SERIES_AGE_RATING_VALUES, {
      error: t("admin.series.validation.age_rating_invalid"),
    }),
    availability: z.enum(SURFACE_AVAILABILITIES, {
      error: t("admin.series.validation.availability_invalid"),
    }),
    // The empty value is one of the four: it is the series stating no mode of
    // its own and so following the tenant's.
    commentMode: z.enum(SERIES_COMMENT_MODES, {
      error: t("admin.series.validation.comment_mode_invalid"),
    }),
    creatorCredits: creatorCreditListFormSchema(
      t("admin.series.validation.creator_credits_invalid")
    ),
    eyeCatchImage: optionalFileFormSchema,
    genrePublicIds: trimmedStringListFormSchema,
    isPublished: checkboxOnFormSchema,
    labelPublicId: requiredTrimmedString(
      t("admin.series.validation.label_required")
    ),
    publishedAt: optionalTrimmedString(),
    readingDirection: z.enum(READING_DIRECTIONS, {
      error: t("admin.series.validation.reading_direction_invalid"),
    }),
    readingPeriodHours: nonNegativeIntFormSchema(
      t("admin.series.validation.reading_period_invalid")
    ),
    scheduleWeekdays: scheduleWeekdaysFormSchema,
    spreadStartIndex: spreadStartPageFormSchema(
      t("admin.series.validation.spread_start_invalid")
    ),
    status: z.enum(SERIES_STATUS_VALUES, {
      error: t("admin.series.validation.status_invalid"),
    }),
    synopsis: requiredTrimmedString(
      t("admin.series.validation.synopsis_required"),
      10_000
    ),
    tagNames: trimmedStringListFormSchema.refine(
      (values) => values.length <= MAX_SERIES_TAGS,
      t("admin.series.validation.tags_too_many", {
        count: String(MAX_SERIES_TAGS),
      })
    ),
    tenantId: requiredTrimmedString(
      t("admin.series.validation.tenant_missing")
    ),
    title: requiredTrimmedString(t("admin.series.validation.title_required")),
  });
};
const seriesUpdateSchema = async (locale: Locale) => {
  const [t, base] = await Promise.all([
    getMessagesFor(locale),
    seriesCommonSchema(locale),
  ]);

  return base.extend({
    publicId: requiredTrimmedString(t("admin.series.validation.id_missing")),
  });
};
const seriesEyeCatchSchema = async (locale: Locale) => {
  const base = await seriesUpdateSchema(locale);

  // The cover image tab does not offer the surfaces, and a save that names
  // none keeps the ones stored.
  return base.omit({ availability: true }).extend({
    clearEyeCatchImage: flagOneFormSchema,
    currentEyeCatchImageUpdatedAt: optionalTrimmedString(),
  });
};
const seriesFormFields = {
  ageRating: { kind: "value", name: "age_rating" },
  availability: "value",
  commentMode: { kind: "value", name: "comment_mode" },
  creatorCredits: { kind: "value", name: "creator_credits" },
  eyeCatchImage: { kind: "file", name: "eye_catch_image" },
  genrePublicIds: { kind: "values", name: "genre_public_ids" },
  isPublished: { kind: "value", name: "is_published" },
  labelPublicId: { kind: "value", name: "label_public_id" },
  publishedAt: { kind: "value", name: "published_at" },
  readingDirection: { kind: "value", name: "reading_direction" },
  readingPeriodHours: { kind: "value", name: "reading_period_hours" },
  scheduleWeekdays: { kind: "values", name: "schedule_weekdays" },
  spreadStartIndex: { kind: "value", name: "spread_start_page" },
  status: { kind: "value", name: "status" },
  synopsis: "value",
  tagNames: { kind: "values", name: "tag_names" },
  tenantId: { kind: "value", name: "tenant_id" },
  title: "value",
} as const;

const toFailure = (
  message: string,
  mode: SeriesMutationMode
): { message: string; mode: SeriesMutationMode; ok: false } => ({
  message,
  mode,
  ok: false,
});

const toEyeCatchImage = async (file: File | undefined) => {
  if (!file) {
    return {
      eyeCatchImageContentType: undefined,
      eyeCatchImageData: undefined,
    };
  }

  return {
    eyeCatchImageContentType: file.type || undefined,
    eyeCatchImageData: new Uint8Array(await file.arrayBuffer()),
  };
};

const resolvePublishedAt = async (
  publishedAtRaw: string,
  tenantId: string,
  mode: SeriesMutationMode,
  locale: Locale
): Promise<
  { ok: true; publishedAt: string } | ReturnType<typeof toFailure>
> => {
  if (!publishedAtRaw) {
    return { ok: true, publishedAt: "" };
  }

  const [t, timeZone] = await Promise.all([
    getMessagesFor(locale),
    getTenantDisplayTimeZone(tenantId),
  ]);
  const publishedAt = toInstantIsoString(publishedAtRaw, timeZone);
  if (publishedAtRaw.length > 0 && publishedAt.length === 0) {
    return toFailure(t("admin.series.validation.published_at_invalid"), mode);
  }

  return { ok: true, publishedAt };
};

export const createSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await seriesCommonSchema(locale);
  const parsed = schema.safeParse(toFormDataInput(formData, seriesFormFields));
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "create");
  }

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "create",
    locale
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  const result = await withAdminSessionReauth(() =>
    createSeries(
      {
        ageRating: parsed.data.ageRating,
        availability: parsed.data.availability,
        commentMode: parsed.data.commentMode,
        creatorCredits: parsed.data.creatorCredits,
        eyeCatchImageContentType,
        eyeCatchImageData,
        genrePublicIds: parsed.data.genrePublicIds,
        isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
        labelPublicId: parsed.data.labelPublicId,
        publishedAt: schedule.publishedAt,
        readingDirection: parsed.data.readingDirection,
        readingPeriodHours: parsed.data.readingPeriodHours,
        scheduleWeekdays: parsed.data.scheduleWeekdays,
        spreadStartIndex: parsed.data.spreadStartIndex,
        status: parsed.data.status,
        synopsis: parsed.data.synopsis,
        tagNames: parsed.data.tagNames,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "create");
  }

  updateTag(seriesListCacheTag(parsed.data.tenantId));
  updateTag(tenantDashboardCacheTag(parsed.data.tenantId));

  redirect(`/series/${result.series.publicId}?created=1`);
};

export const updateSeriesAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const schema = await seriesUpdateSchema(locale);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...seriesFormFields,
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "update");
  }

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "update",
    locale
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  const result = await withAdminSessionReauth(() =>
    updateSeries(
      {
        ageRating: parsed.data.ageRating,
        availability: parsed.data.availability,
        commentMode: parsed.data.commentMode,
        creatorCredits: parsed.data.creatorCredits,
        eyeCatchImageContentType,
        eyeCatchImageData,
        genrePublicIds: parsed.data.genrePublicIds,
        isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
        labelPublicId: parsed.data.labelPublicId,
        publicId: parsed.data.publicId,
        publishedAt: schedule.publishedAt,
        readingDirection: parsed.data.readingDirection,
        readingPeriodHours: parsed.data.readingPeriodHours,
        scheduleWeekdays: parsed.data.scheduleWeekdays,
        spreadStartIndex: parsed.data.spreadStartIndex,
        status: parsed.data.status,
        synopsis: parsed.data.synopsis,
        tagNames: parsed.data.tagNames,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  updateTag(seriesCacheTag(parsed.data.tenantId, parsed.data.publicId));
  updateTag(seriesListCacheTag(parsed.data.tenantId));
  updateTag(tenantDashboardCacheTag(parsed.data.tenantId));

  redirect(`/series/${parsed.data.publicId}?updated=1`);
};

export const updateSeriesEyeCatchAction = async (
  _prevState: SeriesActionState,
  formData: FormData
): Promise<SeriesActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    seriesEyeCatchSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      ...seriesFormFields,
      clearEyeCatchImage: { kind: "value", name: "clear_eye_catch_image" },
      currentEyeCatchImageUpdatedAt: {
        kind: "value",
        name: "current_eye_catch_image_updated_at",
      },
      publicId: { kind: "value", name: "public_id" },
    })
  );
  if (!parsed.success) {
    return toFailure(toFormErrorMessage(parsed.error, { locale }), "update");
  }

  const schedule = await resolvePublishedAt(
    parsed.data.publishedAt,
    parsed.data.tenantId,
    "update",
    locale
  );
  if (!schedule.ok) {
    return schedule;
  }

  const { eyeCatchImageContentType, eyeCatchImageData } = await toEyeCatchImage(
    parsed.data.eyeCatchImage
  );

  if (!parsed.data.clearEyeCatchImage && !eyeCatchImageData) {
    return toFailure(t("admin.series.eye_catch_choice_required"), "update");
  }

  const result = await withAdminSessionReauth(() =>
    updateSeries(
      {
        ageRating: parsed.data.ageRating,
        clearEyeCatchImage: parsed.data.clearEyeCatchImage,
        commentMode: parsed.data.commentMode,
        creatorCredits: parsed.data.creatorCredits,
        eyeCatchImageContentType,
        eyeCatchImageData,
        genrePublicIds: parsed.data.genrePublicIds,
        isPublished: parsed.data.isPublished || schedule.publishedAt.length > 0,
        labelPublicId: parsed.data.labelPublicId,
        publicId: parsed.data.publicId,
        publishedAt: schedule.publishedAt,
        readingDirection: parsed.data.readingDirection,
        readingPeriodHours: parsed.data.readingPeriodHours,
        scheduleWeekdays: parsed.data.scheduleWeekdays,
        spreadStartIndex: parsed.data.spreadStartIndex,
        status: parsed.data.status,
        synopsis: parsed.data.synopsis,
        tagNames: parsed.data.tagNames,
        tenantId: parsed.data.tenantId,
        title: parsed.data.title,
      },
      locale
    )
  );

  if (!result.ok) {
    return toFailure(result.message, "update");
  }

  if (
    eyeCatchImageData &&
    !parsed.data.clearEyeCatchImage &&
    (result.series.eyeCatchImageVariants?.length ?? 0) === 0
  ) {
    return toFailure(t("admin.series.eye_catch_variants_missing"), "update");
  }

  if (
    eyeCatchImageData &&
    !parsed.data.clearEyeCatchImage &&
    parsed.data.currentEyeCatchImageUpdatedAt.length > 0 &&
    result.series.eyeCatchImageUpdatedAt ===
      parsed.data.currentEyeCatchImageUpdatedAt
  ) {
    return toFailure(
      t("admin.series.eye_catch_upload_not_reflected"),
      "update"
    );
  }

  updateTag(seriesCacheTag(parsed.data.tenantId, parsed.data.publicId));
  updateTag(seriesListCacheTag(parsed.data.tenantId));

  return {
    message: t("admin.series.eye_catch_updated"),
    mode: "update",
    ok: true,
    series: result.series,
  };
};

const eyeCatchAspectSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    crop: optionalCropRectFormSchema(t("admin.image_crop.invalid")),
    publicId: requiredTrimmedString(t("admin.series.validation.id_missing")),
    tenantId: requiredTrimmedString(
      t("admin.series.validation.tenant_missing")
    ),
    variantType: requiredTrimmedString(
      t("admin.eye_catch.aspect.variant_type_missing")
    ),
  });
};
const eyeCatchAspectFormFields = {
  crop: { kind: "value", name: CROP_RECT_FIELD },
  publicId: { kind: "value", name: "public_id" },
  tenantId: { kind: "value", name: "tenant_id" },
  variantType: { kind: "value", name: "variant_type" },
} as const;

/**
 * The ratio is echoed back in every result so the slot that submitted is the
 * only one that shows the message — four slots share this Action.
 */
const toAspectFailure = (
  message: string,
  variantType: string
): EyeCatchAspectActionState => ({ message, ok: false, variantType });

export const uploadSeriesEyeCatchAspectImageAction = async (
  _prevState: EyeCatchAspectActionState,
  formData: FormData
): Promise<EyeCatchAspectActionState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    eyeCatchAspectSchema(locale),
  ]);
  const parsed = schema
    .extend({ aspectImage: optionalFileFormSchema })
    .safeParse(
      toFormDataInput(formData, {
        ...eyeCatchAspectFormFields,
        aspectImage: { kind: "file", name: "aspect_image" },
      })
    );
  if (!parsed.success) {
    return toAspectFailure(toFormErrorMessage(parsed.error, { locale }), "");
  }

  const { aspectImage, crop, publicId, tenantId, variantType } = parsed.data;
  if (!aspectImage) {
    return toAspectFailure(
      t("admin.eye_catch.aspect.image_required"),
      variantType
    );
  }

  const imageData = new Uint8Array(await aspectImage.arrayBuffer());
  const result = await withAdminSessionReauth(() =>
    uploadSeriesEyeCatchAspectImage(
      {
        crop,
        imageContentType: aspectImage.type || undefined,
        imageData,
        publicId,
        tenantId,
        variantType,
      },
      locale
    )
  );

  if (!result.ok) {
    return "imageRejected" in result
      ? { imageInvalid: true, ok: false, variantType }
      : toAspectFailure(result.message, variantType);
  }

  updateTag(seriesCacheTag(tenantId, publicId));
  updateTag(seriesListCacheTag(tenantId));

  return {
    message: t("admin.eye_catch.aspect.uploaded"),
    ok: true,
    variantType,
  };
};
