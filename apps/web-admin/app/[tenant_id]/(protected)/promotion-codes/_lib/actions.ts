"use server";

import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { parseInstant, toInstantIsoString } from "@publira/utils";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { verifyAdminSession, withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import { listAllEpisodesForTenant } from "#lib/episode";
import {
  isFormText,
  optionalRecordId,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { MAX_INT32 } from "#lib/int32";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { parseTenantPrice, rawPriceFormSchema } from "#lib/price-action";
import {
  createPromotionCode,
  deletePromotionCode,
  promotionCodesCacheTag,
  setPromotionCodePaused,
  updatePromotionCode,
} from "#lib/promotion-code";
import type { PromotionCodeLimitsInput } from "#lib/promotion-code";
import {
  PROMOTION_CODE_DISCOUNT_KINDS,
  PROMOTION_CODE_TARGET_KINDS,
} from "#lib/promotion-code-shared";
import type { ListPromotionCodeTargetOptionsResult } from "#lib/promotion-code-shared";
import { getTenantDisplayTimeZone } from "#lib/tenant-timezone";
import { listVolumes } from "#lib/volume";

import { promotionCodeListQuery } from "./search-params";

/** A code the API takes: 1 to 32 ASCII letters and digits. */
const CODE_RE = /^[A-Za-z0-9]{1,32}$/u;

const INTEGER_RE = /^\d+$/u;

/**
 * A limit as the form posts it: blank is no limit, sent as `0`, and anything
 * else a whole number of at least one.
 */
const limitFormSchema = (message: string): z.ZodType<number, unknown> =>
  z.preprocess(
    (value) => {
      const raw = isFormText(value) ? value.trim() : "";

      if (raw === "") {
        return 0;
      }

      return INTEGER_RE.test(raw) ? Number(raw) : undefined;
    },
    z
      .number({ error: message })
      .int(message)
      .max(MAX_INT32, message)
      .refine((value) => value === 0 || value >= 1, message)
  );

/** An instant the form posted, or a blank for no bound. */
const instantFormSchema = z.preprocess(
  (value) => (isFormText(value) ? value : ""),
  z.string()
);

const tenantIdSchema = (t: AdminMessageAccessor) =>
  requiredTrimmedString(t("admin.promotion_codes.validation.tenant_missing"));

const limitsSchema = (t: AdminMessageAccessor) =>
  z.object({
    endsAt: instantFormSchema,
    maxRedemptions: limitFormSchema(
      t("admin.promotion_codes.validation.limit_invalid")
    ),
    maxRedemptionsPerReader: limitFormSchema(
      t("admin.promotion_codes.validation.limit_invalid")
    ),
    startsAt: instantFormSchema,
  });

const limitsFormFields = {
  endsAt: { kind: "value", name: "ends_at" },
  maxRedemptions: { kind: "value", name: "max_redemptions" },
  maxRedemptionsPerReader: {
    kind: "value",
    name: "max_redemptions_per_reader",
  },
  startsAt: { kind: "value", name: "starts_at" },
} as const;

/** The name each field of the Actions' schemas is posted under. */
const formFieldNames = {
  code: "code",
  discountKind: "discount_kind",
  discountValue: "discount_value",
  endsAt: "ends_at",
  maxRedemptions: "max_redemptions",
  maxRedemptionsPerReader: "max_redemptions_per_reader",
  startsAt: "starts_at",
  targetId: "target_id",
  targetKind: "target_kind",
} satisfies Record<string, string>;

/** A refused field's message under the name the form posts the field by. */
const toFormFieldErrors = (
  fieldErrors: Partial<Record<string, string>>
): ActionForm.FieldErrors =>
  Object.fromEntries(
    Object.entries(fieldErrors).map(([field, message]) => [
      Object.entries(formFieldNames).find(([key]) => key === field)?.[1] ??
        field,
      message,
    ])
  );

/** What a refused submission answers: the form's message, and each field's. */
const invalidState = <T>(
  error: z.ZodError<T>,
  locale: Locale
): ActionForm.State => ({
  fieldErrors: toFormFieldErrors(toFieldErrors(error)),
  message: toFormErrorMessage(error, { locale }),
  ok: false,
});

/**
 * The window a form posted, as the two instants the API takes, each blank for
 * no bound. Each field carries the instant the form resolved in the zone it
 * was rendered in; a leftover wall clock (no JS) is read in `timeZone`. An end
 * at or before the start is refused here as the API refuses it, so the
 * operator is answered beside the field.
 */
const toWindow = (
  input: { endsAt: string; startsAt: string },
  timeZone: string,
  t: AdminMessageAccessor
):
  | { endsAt: string; ok: true; startsAt: string }
  | { fieldErrors: ActionForm.FieldErrors; ok: false } => {
  const startsAt = toInstantIsoString(input.startsAt, timeZone);
  const endsAt = toInstantIsoString(input.endsAt, timeZone);
  const start = parseInstant(startsAt);
  const end = parseInstant(endsAt);

  // A value that names no instant converts to "", which reads as no bound,
  // so it is told apart from a field left blank by what was posted.
  if (input.startsAt.trim() && !start) {
    return {
      fieldErrors: {
        starts_at: t("admin.promotion_codes.validation.starts_at_invalid"),
      },
      ok: false,
    };
  }

  if (input.endsAt.trim() && !end) {
    return {
      fieldErrors: {
        ends_at: t("admin.promotion_codes.validation.ends_at_invalid"),
      },
      ok: false,
    };
  }

  if (start && end && Temporal.Instant.compare(end, start) <= 0) {
    return {
      fieldErrors: {
        ends_at: t("admin.promotion_codes.validation.ends_before_starts"),
      },
      ok: false,
    };
  }

  return { endsAt, ok: true, startsAt };
};

const createSchema = (t: AdminMessageAccessor) =>
  limitsSchema(t).extend({
    code: z
      .string({ error: t("admin.promotion_codes.validation.code_invalid") })
      .trim()
      .regex(CODE_RE, t("admin.promotion_codes.validation.code_invalid"))
      .transform((value) => value.toUpperCase()),
    discountCurrency: z.string().trim().catch(""),
    discountKind: z.enum(PROMOTION_CODE_DISCOUNT_KINDS, {
      error: t("admin.promotion_codes.validation.discount_kind_required"),
    }),
    discountValue: rawPriceFormSchema,
    targetId: optionalRecordId(
      t("admin.promotion_codes.validation.target_missing")
    ),
    targetKind: z.enum(PROMOTION_CODE_TARGET_KINDS, {
      error: t("admin.promotion_codes.validation.target_kind_required"),
    }),
    tenantId: tenantIdSchema(t),
  });

/** A discount the form posted that cannot be read, said beside its field. */
const invalidDiscount = (message: string) => ({
  fieldErrors: { discount_value: message },
  message,
  ok: false as const,
});

/**
 * The discount the form posted: a whole percentage from 1 to 100, or an
 * amount of at least the currency's smallest unit, read in the currency the
 * tenant sells in now as every price is.
 */
const toDiscountValue = async (
  input: {
    discountCurrency: string;
    discountKind: "amount" | "percent";
    discountValue: string;
    tenantId: string;
  },
  locale: Locale,
  t: AdminMessageAccessor
): Promise<
  | { currency: string; ok: true; value: number }
  | { fieldErrors: ActionForm.FieldErrors; message: string; ok: false }
> => {
  if (input.discountKind === "percent") {
    const raw = input.discountValue.trim();
    const value = INTEGER_RE.test(raw) ? Number(raw) : Number.NaN;

    return Number.isInteger(value) && value >= 1 && value <= 100
      ? { currency: "", ok: true, value }
      : invalidDiscount(t("admin.promotion_codes.validation.percent_invalid"));
  }

  const price = await parseTenantPrice(
    input.discountValue,
    input.discountCurrency,
    input.tenantId,
    locale,
    "admin.promotion_codes.validation.amount_invalid"
  );

  if (!price.ok) {
    return invalidDiscount(price.message);
  }

  if (price.value <= 0) {
    return invalidDiscount(
      t("admin.promotion_codes.validation.amount_invalid")
    );
  }

  return { currency: price.currency, ok: true, value: price.value };
};

/** Creates the code the new screen submitted and opens it in the drawer. */
export const createPromotionCodeAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = createSchema(t)
    .superRefine((value, context) => {
      if (value.targetKind !== "catalog" && value.targetId === "") {
        context.addIssue({
          code: "custom",
          message: t("admin.promotion_codes.validation.target_missing"),
          path: ["targetId"],
        });
      }
    })
    .safeParse(
      toFormDataInput(formData, {
        ...limitsFormFields,
        code: "value",
        discountCurrency: { kind: "value", name: "discount_currency" },
        discountKind: { kind: "value", name: "discount_kind" },
        discountValue: { kind: "value", name: "discount_value" },
        targetId: { kind: "value", name: "target_id" },
        targetKind: { kind: "value", name: "target_kind" },
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );

  if (!parsed.success) {
    return invalidState(parsed.error, locale);
  }

  const { tenantId } = parsed.data;

  const [discount, timeZone] = await Promise.all([
    toDiscountValue(parsed.data, locale, t),
    getTenantDisplayTimeZone(tenantId),
  ]);

  if (!discount.ok) {
    return discount;
  }

  const window = toWindow(parsed.data, timeZone, t);

  if (!window.ok) {
    return {
      fieldErrors: window.fieldErrors,
      message: t("errors.validation"),
      ok: false,
    };
  }

  const limits: PromotionCodeLimitsInput = {
    endsAt: window.endsAt,
    maxRedemptions: parsed.data.maxRedemptions,
    maxRedemptionsPerReader: parsed.data.maxRedemptionsPerReader,
    startsAt: window.startsAt,
  };

  const result = await withAdminSessionReauth(() =>
    createPromotionCode(
      {
        code: parsed.data.code,
        currency: discount.currency,
        discountKind: parsed.data.discountKind,
        discountValue: discount.value,
        limits,
        targetId: parsed.data.targetId,
        targetKind: parsed.data.targetKind,
        tenantId,
      },
      locale
    )
  );

  // A code in use, a discount out of range, or a window the API refused
  // comes back as the error on its field.
  if (!result.ok) {
    return result;
  }

  updateTag(promotionCodesCacheTag(tenantId));

  // The code exists, so staying on this form would only invite a second one.
  redirect(
    `/promotion-codes${promotionCodeListQuery({ code: result.code.id })}&created=1`
  );
};

const codeIdSchema = (t: AdminMessageAccessor) =>
  requiredRecordId(t("admin.promotion_codes.validation.code_missing"));

/**
 * Saves the window and the limits the drawer's edit form submitted, and goes
 * back to the code's terms on the page of the list it was opened from.
 */
export const updatePromotionCodeAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = limitsSchema(t)
    .extend({
      id: codeIdSchema(t),
      listToken: z.string().trim().catch(""),
      tenantId: tenantIdSchema(t),
    })
    .safeParse(
      toFormDataInput(formData, {
        ...limitsFormFields,
        id: { kind: "value", name: "promotion_code_id" },
        listToken: { kind: "value", name: "list_token" },
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );

  if (!parsed.success) {
    return invalidState(parsed.error, locale);
  }

  const { id, listToken, tenantId } = parsed.data;

  const window = toWindow(
    parsed.data,
    await getTenantDisplayTimeZone(tenantId),
    t
  );

  if (!window.ok) {
    return {
      fieldErrors: window.fieldErrors,
      message: t("errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updatePromotionCode(
      {
        id,
        limits: {
          endsAt: window.endsAt,
          maxRedemptions: parsed.data.maxRedemptions,
          maxRedemptionsPerReader: parsed.data.maxRedemptionsPerReader,
          startsAt: window.startsAt,
        },
        tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return result;
  }

  updateTag(promotionCodesCacheTag(tenantId));

  redirect(
    `/promotion-codes${promotionCodeListQuery({ code: id, token: listToken })}&saved=1`
  );
};

/**
 * Pauses the code the drawer shows, or resumes it, as the button posted. The
 * drawer is re-rendered from the cleared reads, so it shows the code as it
 * now stands, and success is a toast.
 */
export const setPromotionCodePausedAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      id: codeIdSchema(t),
      paused: z.enum(["0", "1"]).transform((value) => value === "1"),
      tenantId: tenantIdSchema(t),
    })
    .safeParse(
      toFormDataInput(formData, {
        id: { kind: "value", name: "promotion_code_id" },
        paused: "value",
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    setPromotionCodePaused(parsed.data, locale)
  );

  if (!result.ok) {
    return result;
  }

  updateTag(promotionCodesCacheTag(parsed.data.tenantId));

  return {
    message: parsed.data.paused
      ? t("admin.promotion_codes.paused", { code: result.code.code })
      : t("admin.promotion_codes.resumed", { code: result.code.code }),
    ok: true,
  };
};

/** Deletes the code the drawer shows, and closes the drawer on the list. */
export const deletePromotionCodeAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      id: codeIdSchema(t),
      listToken: z.string().trim().catch(""),
      tenantId: tenantIdSchema(t),
    })
    .safeParse(
      toFormDataInput(formData, {
        id: { kind: "value", name: "promotion_code_id" },
        listToken: { kind: "value", name: "list_token" },
        tenantId: { kind: "value", name: "tenant_id" },
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    deletePromotionCode(parsed.data, locale)
  );

  if (!result.ok) {
    return result;
  }

  updateTag(promotionCodesCacheTag(parsed.data.tenantId));

  const query = promotionCodeListQuery({ token: parsed.data.listToken });
  const separator = query === "?" ? "" : "&";

  redirect(`/promotion-codes${query}${separator}deleted=1`);
};

const targetOptionsSchema = (t: AdminMessageAccessor) =>
  z.object({
    kind: z.enum(["episode", "volume"]),
    seriesId: requiredRecordId(
      t("admin.promotion_codes.validation.series_missing")
    ),
    tenantId: tenantIdSchema(t),
  });

/**
 * The episodes or the volumes of the series the target picker chose, for the
 * picker beside it. This Server Action only reads them; the same-origin check
 * applies to mutations.
 */
export const listPromotionCodeTargetOptionsAction = async (
  input: { kind: string; seriesId: string; tenantId: string },
  locale: Locale
): Promise<ListPromotionCodeTargetOptionsResult> => {
  const t = await getMessagesFor(locale);
  const parsed = targetOptionsSchema(t).safeParse(input);

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
      options: [],
    };
  }

  // The tenant comes from the client, and the episodes are read with the
  // service credential, which answers for any tenant.
  await verifyAdminSession(parsed.data.tenantId);

  if (parsed.data.kind === "volume") {
    const result = await listVolumes(
      { seriesId: parsed.data.seriesId, tenantId: parsed.data.tenantId },
      locale
    );

    return result.ok
      ? {
          ok: true,
          options: result.volumes.map((volume) => ({
            id: volume.id,
            label: volume.title || volume.publicId,
          })),
        }
      : { message: result.message, ok: false, options: [] };
  }

  const result = await listAllEpisodesForTenant(
    { seriesId: parsed.data.seriesId, tenantId: parsed.data.tenantId },
    locale
  );

  return result.ok
    ? {
        ok: true,
        options: result.episodes.map((episode) => ({
          id: episode.id,
          label: t("admin.promotion_codes.form.target_option", {
            id: episode.publicId,
            title: episode.title,
          }),
        })),
      }
    : { message: result.message, ok: false, options: [] };
};
