"use server";

import { getLocaleLabel, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import {
  announcementsCacheTag,
  countAnnouncementAudience,
  createAnnouncement,
  deleteAnnouncement,
  unpinAnnouncement,
  updateAnnouncement,
} from "#lib/announcement";
import type {
  AnnouncementInput,
  CountAnnouncementAudienceResult,
} from "#lib/announcement";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  isFormText,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getLocale } from "#lib/locale";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";

import type {
  AnnouncementAudienceCondition,
  AnnouncementFieldErrors,
  AnnouncementTranslationInput,
  CreateAnnouncementActionState,
} from "../announcement-types";

/** The fewest and most days a day-count condition takes, as the API bounds them. */
const AUDIENCE_DAYS_MIN = 1;
const AUDIENCE_DAYS_MAX = 3650;

/**
 * One language's fields as the form posts them: every tab posts a
 * `translation_locale`, a `title`, and a `body`, in the same order, the default
 * language's with an empty locale.
 */
const zipTranslations = ({
  bodies,
  titles,
  translationLocales,
}: {
  bodies: string[];
  titles: string[];
  translationLocales: string[];
}) =>
  translationLocales.map((translationLocale, index) => ({
    body: bodies[index],
    locale: translationLocale,
    title: titles[index],
  }));

const translationsSchema = (t: AdminMessageAccessor) =>
  z
    .array(
      z.object({
        body: optionalTrimmedString(
          2000,
          t("admin.announcements.validation.body_required")
        ),
        locale: z
          .string()
          .trim()
          .refine(
            (value) => value === "" || parseLocale(value) !== undefined,
            t("admin.announcements.validation.locale_invalid")
          )
          .transform((value) => parseLocale(value) ?? ""),
        title: optionalTrimmedString(
          120,
          t("admin.announcements.validation.title_required")
        ),
      })
    )
    .superRefine((translations, ctx) => {
      if (!translations.some(({ locale }) => locale === "")) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.announcements.validation.title_required"),
        });
      }

      for (const [index, { body, locale, title }] of translations.entries()) {
        // The default language's translation is what a reader browsing in a
        // language left empty is shown, so it is the one that is required.
        if (locale === "") {
          if (title === "") {
            ctx.addIssue({
              code: "custom",
              message: t("admin.announcements.validation.title_required"),
              path: [index, "title"],
            });
          }

          if (body === "") {
            ctx.addIssue({
              code: "custom",
              message: t("admin.announcements.validation.body_required"),
              path: [index, "body"],
            });
          }
        } else if ((title === "") !== (body === "")) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.announcements.validation.translation_incomplete",
              {
                language: getLocaleLabel(locale),
              }
            ),
            path: [index],
          });
        }
      }
    })
    .transform((translations): AnnouncementTranslationInput[] =>
      // A language whose tab was left empty is not written in.
      translations.filter(
        ({ body, locale, title }) =>
          locale === "" || title !== "" || body !== ""
      )
    );

/**
 * The conditions of a targeted audience, as the form posts them and as the
 * reach count sends them: each type once, a series for a series condition, a
 * day count the API takes. Whether the tenant owns the series or the plan, or
 * offers the locale, is the API's to answer.
 */
const audienceConditionsSchema = (t: AdminMessageAccessor) => {
  const seriesPublicId = z
    .string()
    .trim()
    .min(1, t("admin.announcements.validation.audience_series_required"))
    .max(64);

  const days = z.coerce
    .number(t("admin.announcements.validation.audience_days_range"))
    .int(t("admin.announcements.validation.audience_days_range"))
    .min(
      AUDIENCE_DAYS_MIN,
      t("admin.announcements.validation.audience_days_range")
    )
    .max(
      AUDIENCE_DAYS_MAX,
      t("admin.announcements.validation.audience_days_range")
    );

  return z
    .array(
      z.discriminatedUnion(
        "type",
        [
          z.object({ seriesPublicId, type: z.literal("follows_series") }),
          z.object({
            seriesPublicId,
            type: z.literal("bought_series_episode"),
          }),
          z.object({
            planPublicId: z.string().trim().max(64),
            state: z.enum(["active", "ended"]),
            type: z.literal("subscription"),
          }),
          z.object({ type: z.literal("never_purchased") }),
          z.object({ days, type: z.literal("last_read_days_ago") }),
          z.object({ days, type: z.literal("signed_up_within_days") }),
          z.object({
            locale: z
              .string()
              .transform((value) => parseLocale(value.trim()))
              .pipe(
                z.custom<Locale>(
                  (value) => value !== undefined,
                  t("admin.announcements.validation.locale_invalid")
                )
              ),
            type: z.literal("locale"),
          }),
          z.object({ type: z.literal("has_mobile_push_device") }),
        ],
        t("admin.announcements.validation.audience_condition_invalid")
      )
    )
    .min(1, t("admin.announcements.validation.audience_condition_required"))
    .superRefine((conditions, ctx) => {
      const seen = new Set<string>();

      for (const [index, { type }] of conditions.entries()) {
        if (seen.has(type)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.announcements.validation.audience_condition_duplicate"
            ),
            path: [index],
          });
        }

        seen.add(type);
      }
    })
    .transform((conditions): AnnouncementAudienceCondition[] => conditions);
};

/**
 * What a refused audience says about the form's fields: a condition's own
 * inputs under `audience.<type>`, and anything about the set — none at all, a
 * type twice, one the form does not know — under `audience`.
 */
const audienceFieldErrors = (
  error: z.ZodError,
  raw: readonly { type: string }[]
): AnnouncementFieldErrors => {
  const fieldErrors: AnnouncementFieldErrors = {};

  for (const issue of error.issues) {
    const [index, field] = issue.path;
    const type = raw.find((_, rowIndex) => rowIndex === index)?.type;

    const key =
      type !== undefined && field !== undefined
        ? `audience.${type}`
        : "audience";

    fieldErrors[key] ??= issue.message;
  }

  return fieldErrors;
};

/**
 * The inputs of every condition row, each named after the one type it belongs
 * to: an audience names a type at most once, so a type's inputs are never
 * posted twice.
 */
interface AudienceConditionFields {
  boughtSeriesEpisodeSeries?: string;
  followsSeriesSeries?: string;
  lastReadDaysAgoDays?: string;
  locale?: string;
  signedUpWithinDaysDays?: string;
  subscriptionPlan?: string;
  subscriptionState?: string;
}

/** The condition rows as the form posts them, in order, before they are validated. */
const toRawConditions = (
  types: readonly string[],
  fields: AudienceConditionFields
) =>
  types.map((type) => {
    switch (type) {
      case "follows_series": {
        return { seriesPublicId: fields.followsSeriesSeries ?? "", type };
      }

      case "bought_series_episode": {
        return { seriesPublicId: fields.boughtSeriesEpisodeSeries ?? "", type };
      }

      case "subscription": {
        return {
          planPublicId: fields.subscriptionPlan ?? "",
          state: fields.subscriptionState ?? "",
          type,
        };
      }

      case "last_read_days_ago": {
        return { days: fields.lastReadDaysAgoDays ?? "", type };
      }

      case "signed_up_within_days": {
        return { days: fields.signedUpWithinDaysDays ?? "", type };
      }

      case "locale": {
        return { locale: fields.locale ?? "", type };
      }

      default: {
        return { type };
      }
    }
  });

const announcementFormSchema = (t: AdminMessageAccessor) =>
  z
    .object({
      audience: z.preprocess(
        (value) => (value === "targeted" ? "targeted" : "everyone"),
        z.enum(["everyone", "targeted"])
      ),
      deliverAt: optionalTrimmedString(64),
      // Unchecked, the checkbox posts nothing, which is the default delivery.
      delivery: z.preprocess(
        (value) => (value === "everyone" ? "everyone" : "preferred"),
        z.enum(["everyone", "preferred"])
      ),
      linkUrl: optionalTrimmedString(2048),
      // An unchecked checkbox posts nothing at all, which is the "no banner"
      // answer rather than a missing field.
      pinned: z.preprocess(
        (value) => isFormText(value) && value.trim() !== "",
        z.boolean()
      ),
      pinnedUntil: optionalTrimmedString(64),
      tenantId: requiredTrimmedString(
        t("admin.announcements.validation.tenant_missing")
      ),
      translations: translationsSchema(t),
    })
    .superRefine((value, ctx) => {
      const isInternalPath =
        value.linkUrl.startsWith("/") && !value.linkUrl.startsWith("//");

      if (
        value.linkUrl !== "" &&
        !isInternalPath &&
        !value.linkUrl.startsWith("https://") &&
        !value.linkUrl.startsWith("http://")
      ) {
        ctx.addIssue({
          code: "custom",
          message: t("admin.announcements.validation.link_invalid"),
          path: ["linkUrl"],
        });
      }
    });

/**
 * An instant the form posted, read as the form wrote it.
 *
 * The form posts an absolute instant resolved against the zone it was rendered
 * in. A leftover `datetime-local` wall clock (no JS) is still accepted and read
 * in the tenant's current display zone, the same way an episode's publish time
 * is. Empty answers empty; anything else has to be after `after`.
 */
const toFutureInstant = (
  raw: string,
  timeZone: string,
  after: Temporal.Instant
): { ok: true; value: string } | { ok: false; invalid: boolean } => {
  if (!raw) {
    return { ok: true, value: "" };
  }

  const value = toInstantIsoString(raw, timeZone);
  const parsed = parseInstant(value);

  if (!parsed) {
    return { invalid: true, ok: false };
  }

  if (Temporal.Instant.compare(parsed, after) <= 0) {
    return { invalid: false, ok: false };
  }

  return { ok: true, value };
};

type ParsedAnnouncementForm =
  | { ok: true; input: AnnouncementInput; locale: Locale }
  | { ok: false; state: CreateAnnouncementActionState };

/**
 * Everything the create and the save of a scheduled announcement post, checked
 * the same way: the translations, the audience, the delivery time, and the
 * banner's end.
 */
const parseAnnouncementForm = async (
  formData: FormData
): Promise<ParsedAnnouncementForm> => {
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const { bodies, titles, translationLocales, ...fields } = toFormDataInput(
    formData,
    {
      audience: "value",
      bodies: { kind: "values", name: "body" },
      deliverAt: { kind: "value", name: "deliver_at" },
      delivery: "value",
      linkUrl: { kind: "value", name: "link_url" },
      pinned: "value",
      pinnedUntil: { kind: "value", name: "pinned_until" },
      tenantId: { kind: "value", name: "tenant_id" },
      titles: { kind: "values", name: "title" },
      translationLocales: { kind: "values", name: "translation_locale" },
    }
  );

  const { types: audienceConditions, ...audienceFields } = toFormDataInput(
    formData,
    {
      boughtSeriesEpisodeSeries: {
        kind: "value",
        name: "audience_bought_series_episode_series",
      },
      followsSeriesSeries: {
        kind: "value",
        name: "audience_follows_series_series",
      },
      lastReadDaysAgoDays: {
        kind: "value",
        name: "audience_last_read_days_ago_days",
      },
      locale: { kind: "value", name: "audience_locale_locale" },
      signedUpWithinDaysDays: {
        kind: "value",
        name: "audience_signed_up_within_days_days",
      },
      subscriptionPlan: { kind: "value", name: "audience_subscription_plan" },
      subscriptionState: { kind: "value", name: "audience_subscription_state" },
      types: { kind: "values", name: "audience_condition" },
    }
  );

  const parsed = announcementFormSchema(t).safeParse({
    ...fields,
    translations: zipTranslations({ bodies, titles, translationLocales }),
  });

  if (!parsed.success) {
    return {
      ok: false,
      state: {
        message: toFormErrorMessage(parsed.error, { locale }),
        ok: false,
      },
    };
  }

  const { data } = parsed;
  let audience: AnnouncementAudienceCondition[] | null = null;

  if (data.audience === "targeted") {
    const rawConditions = toRawConditions(audienceConditions, audienceFields);
    const conditions = audienceConditionsSchema(t).safeParse(rawConditions);

    if (!conditions.success) {
      return {
        ok: false,
        state: {
          fieldErrors: audienceFieldErrors(conditions.error, rawConditions),
          message: toFormErrorMessage(conditions.error, { locale }),
          ok: false,
        },
      };
    }

    // A targeted announcement is never shown to a visitor with no session, nor
    // kept from readers who turned announcements off, and the form disables
    // both controls while it has conditions; only a crafted post gets here.
    if (data.pinned || data.delivery === "everyone") {
      const message = t(
        "admin.announcements.validation.audience_targeted_broadcast"
      );

      return {
        ok: false,
        state: { fieldErrors: { audience: message }, message, ok: false },
      };
    }

    audience = conditions.data;
  }

  const timeZone =
    data.deliverAt || (data.pinned && data.pinnedUntil)
      ? await getTenantDisplayTimeZone(data.tenantId)
      : "";

  const now = Temporal.Now.instant();
  const deliverAt = toFutureInstant(data.deliverAt, timeZone, now);

  if (!deliverAt.ok) {
    const message = deliverAt.invalid
      ? t("admin.announcements.validation.deliver_at_invalid")
      : t("admin.announcements.validation.deliver_at_future");

    return {
      ok: false,
      state: { fieldErrors: { deliverAt: message }, message, ok: false },
    };
  }

  let pinnedUntil = "";

  if (data.pinned) {
    const deliveredFrom = parseInstant(deliverAt.value);

    const banner = toFutureInstant(
      data.pinnedUntil,
      timeZone,
      deliveredFrom ?? now
    );

    if (!banner.ok) {
      let message = t("admin.announcements.validation.pinned_until_future");

      if (banner.invalid) {
        message = t("admin.announcements.validation.pinned_until_invalid");
      } else if (deliveredFrom) {
        message = t(
          "admin.announcements.validation.pinned_until_after_deliver_at"
        );
      }

      return { ok: false, state: { message, ok: false } };
    }

    pinnedUntil = banner.value;
  }

  return {
    input: {
      audience,
      deliverAt: deliverAt.value,
      delivery: data.delivery,
      linkUrl: data.linkUrl,
      pinned: data.pinned,
      pinnedUntil,
      tenantId: data.tenantId,
      translations: data.translations,
    },
    locale,
    ok: true,
  };
};

export const createAnnouncementAction = async (
  _prevState: CreateAnnouncementActionState,
  formData: FormData
): Promise<CreateAnnouncementActionState> => {
  await assertSameOrigin();
  const parsed = await parseAnnouncementForm(formData);

  if (!parsed.ok) {
    return parsed.state;
  }

  const result = await withAdminSessionReauth(() =>
    createAnnouncement(parsed.input, parsed.locale)
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(announcementsCacheTag(parsed.input.tenantId));
  redirect("/announcements");
};

const announcementIdSchema = z.string().trim().pipe(z.uuid());

/**
 * Save a scheduled announcement over what it held. An empty delivery time
 * delivers it now, the way a create with none does.
 */
export const updateAnnouncementAction = async (
  _prevState: CreateAnnouncementActionState,
  formData: FormData
): Promise<CreateAnnouncementActionState> => {
  await assertSameOrigin();
  const parsed = await parseAnnouncementForm(formData);

  if (!parsed.ok) {
    return parsed.state;
  }

  // Written by the page rather than typed, so a failure here is a bug in the
  // page and gets the shared validation wording.
  const announcementId = announcementIdSchema.safeParse(
    formData.get("announcement_id")
  );

  if (!announcementId.success) {
    return {
      message: toFormErrorMessage(announcementId.error, {
        locale: parsed.locale,
      }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateAnnouncement(
      { ...parsed.input, announcementId: announcementId.data },
      parsed.locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(announcementsCacheTag(parsed.input.tenantId));
  redirect("/announcements");
};

const announcementRowFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    // Both fields are written by the page rather than typed, so a failure here
    // is a bug in the page and gets the shared validation wording.
    announcementId: announcementIdSchema,
    tenantId: requiredTrimmedString(
      t("admin.announcements.validation.tenant_missing")
    ),
  });
};

const parseAnnouncementRowForm = async (formData: FormData) => {
  const locale = await getActionLocale(formData);
  const schema = await announcementRowFormSchema(locale);

  return {
    locale,
    parsed: schema.safeParse(
      toFormDataInput(formData, {
        announcementId: { kind: "value", name: "announcement_id" },
        tenantId: { kind: "value", name: "tenant_id" },
      })
    ),
  };
};

/** Delete a scheduled announcement, and go back to the list it is gone from. */
export const deleteAnnouncementAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseAnnouncementRowForm(formData);

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    deleteAnnouncement(
      {
        announcementId: parsed.data.announcementId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(announcementsCacheTag(parsed.data.tenantId));
  redirect("/announcements");
};

/**
 * Take one announcement's banner down. The announcement stays in the list, so
 * this is the control an operator reaches for once the event a notice was about
 * is over.
 */
export const unpinAnnouncementAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const { locale, parsed } = await parseAnnouncementRowForm(formData);

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    unpinAnnouncement(
      {
        announcementId: parsed.data.announcementId,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  updateTag(announcementsCacheTag(parsed.data.tenantId));

  return null;
};

/**
 * How many readers the conditions on the form select now, for the line beside
 * them. The conditions are checked with the schema the form's submission is,
 * and a set that would be refused is not counted.
 */
export const countAnnouncementAudienceAction = async (input: {
  tenantId: string;
  conditions: unknown;
}): Promise<CountAnnouncementAudienceResult> => {
  await assertSameOrigin();
  const tenantId = z.string().trim().min(1).safeParse(input.tenantId);

  if (!tenantId.success) {
    return { ok: false };
  }

  const t = await getMessagesFor(await getLocale(tenantId.data));
  const conditions = audienceConditionsSchema(t).safeParse(input.conditions);

  if (!conditions.success) {
    return { ok: false };
  }

  return withAdminSessionReauth(() =>
    countAnnouncementAudience({
      audience: conditions.data,
      tenantId: tenantId.data,
    })
  );
};
