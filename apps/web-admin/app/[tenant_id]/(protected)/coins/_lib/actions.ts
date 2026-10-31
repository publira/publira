"use server";

import { getLocaleLabel } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import type * as ActionForm from "@publira/ui-components/action-form";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  COIN_CONTACT_MAX_LENGTH,
  COIN_EXPIRY_DAYS_MAX,
  COIN_ISSUER_NAME_MAX_LENGTH,
  COIN_NAME_MAX_LENGTH,
  COIN_NOTICE_MAX_LENGTH,
  COIN_PACK_LIMIT,
  COIN_TERMS_URL_MAX_LENGTH,
  coinNameField,
  coinsCacheTag,
  createCoinPack,
  readCoinPacksForWrite,
  reorderCoinPacks,
  retireCoinPack,
  updateCoinPack,
  updateCoinSettings,
} from "#lib/coins";
import type { CoinName, CoinSettingsFieldErrors } from "#lib/coins";
import { assertSameOrigin } from "#lib/csrf";
import {
  checkboxOnFormSchema,
  isFormText,
  jsonRecordIdArrayFormSchema,
  nonNegativeIntFormSchema,
  optionalTrimmedString,
  requiredRecordId,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { MAX_INT32 } from "#lib/int32";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import { parseTenantPrice, rawPriceFormSchema } from "#lib/price-action";
import { findTenantLocales } from "#lib/tenant-locales";

import type { CoinPackReorderResult } from "../coin-types";

/**
 * An absolute `http://` or `https://` URL, or empty, as the API takes a terms
 * URL: the text as written, which `URL` alone would repair.
 */
const termsUrlSchema = (message: string) =>
  optionalTrimmedString(COIN_TERMS_URL_MAX_LENGTH, message).refine((value) => {
    if (value === "") {
      return true;
    }

    const lower = value.toLowerCase();

    if (
      /\s/u.test(value) ||
      !(lower.startsWith("https://") || lower.startsWith("http://"))
    ) {
      return false;
    }

    return URL.canParse(value) && new URL(value).host !== "";
  }, message);

/** A whole number of days, blank for none stated yet. */
const expiryDaysSchema = (message: string) =>
  z.preprocess(
    (value) => {
      const raw = isFormText(value) ? value.trim() : "";

      if (raw === "") {
        return 0;
      }

      return /^\d+$/u.test(raw) ? Number(raw) : undefined;
    },
    z
      .number({ error: message })
      .int(message)
      .min(0, message)
      .max(COIN_EXPIRY_DAYS_MAX, message)
  );

const coinSettingsSchema = (t: AdminMessageAccessor) =>
  z.object({
    coinName: optionalTrimmedString(),
    coinUnitAmount: rawPriceFormSchema,
    contact: optionalTrimmedString(
      COIN_CONTACT_MAX_LENGTH,
      t("admin.coins.settings.validation.contact_invalid")
    ),
    currency: optionalTrimmedString(),
    enabled: checkboxOnFormSchema,
    expiryDays: expiryDaysSchema(
      t("admin.coins.settings.validation.expiry_days_invalid")
    ),
    issuerName: optionalTrimmedString(
      COIN_ISSUER_NAME_MAX_LENGTH,
      t("admin.coins.settings.validation.issuer_name_invalid")
    ),
    notice: optionalTrimmedString(
      COIN_NOTICE_MAX_LENGTH,
      t("admin.coins.settings.validation.notice_invalid")
    ),
    selling: checkboxOnFormSchema,
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    termsUrl: termsUrlSchema(
      t("admin.coins.settings.validation.terms_url_invalid")
    ),
  });

/** The tenant's word for its coins a form posted, or the console's own. */
const coinNameOrFallback = (posted: string, t: AdminMessageAccessor) =>
  posted || t("admin.coins.fallback_name");

/** The names a settings form posted, and the fields that refused theirs. */
interface PostedCoinNames {
  fieldErrors: CoinSettingsFieldErrors;
  names: CoinName[];
}

/**
 * The names a settings form posted, one field per language the site offers.
 * The default language's is required whether or not coins are on, so the word
 * readers fall back to is never missing; the others may be left empty, which
 * removes that name.
 */
const parseCoinNames = (
  formData: FormData,
  locales: { defaultLocale: Locale; supportedLocales: readonly Locale[] },
  t: AdminMessageAccessor
): PostedCoinNames => {
  const nameSchema = optionalTrimmedString(Number.MAX_SAFE_INTEGER);
  const names: CoinName[] = [];
  const fieldErrors: CoinSettingsFieldErrors = {};

  for (const code of locales.supportedLocales) {
    const parsed = nameSchema.safeParse(formData.get(coinNameField(code)));
    const name = parsed.success ? parsed.data : "";

    if (name === "") {
      if (code === locales.defaultLocale) {
        fieldErrors[coinNameField(code)] = t(
          "admin.coins.settings.validation.default_name_required",
          { language: getLocaleLabel(code) }
        );
      }

      continue;
    }

    if ([...name].length > COIN_NAME_MAX_LENGTH) {
      fieldErrors[coinNameField(code)] = t(
        "admin.coins.settings.validation.name_invalid",
        { count: COIN_NAME_MAX_LENGTH }
      );
      continue;
    }

    names.push({ locale: code, name });
  }

  return { fieldErrors, names };
};

export const updateCoinSettingsAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = coinSettingsSchema(t).safeParse(
    toFormDataInput(formData, {
      coinName: { kind: "value", name: "coin_name" },
      coinUnitAmount: { kind: "value", name: "coin_unit_amount" },
      contact: "value",
      currency: "value",
      enabled: "value",
      expiryDays: { kind: "value", name: "expiry_days" },
      issuerName: { kind: "value", name: "issuer_name" },
      notice: "value",
      selling: "value",
      tenantId: { kind: "value", name: "tenant_id" },
      termsUrl: { kind: "value", name: "terms_url" },
    })
  );

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const input = parsed.data;

  const locales = await findTenantLocales(input.tenantId);

  if (!locales) {
    return {
      message: t("admin.coins.settings.locales_unavailable"),
      ok: false,
    };
  }

  const { fieldErrors, names } = parseCoinNames(formData, locales, t);

  const coinUnitAmount = await parseTenantPrice(
    input.coinUnitAmount,
    input.currency,
    input.tenantId,
    locale,
    "admin.coins.settings.validation.unit_amount_invalid"
  );

  if (!coinUnitAmount.ok) {
    fieldErrors.coinUnitAmount = coinUnitAmount.message;
  }

  // The API names only the first of these it finds missing, so the form
  // names every one of them at once.
  if (input.enabled) {
    const required = [
      [
        coinUnitAmount.ok && coinUnitAmount.value === 0,
        "coinUnitAmount",
        "admin.coins.settings.validation.unit_amount_required",
      ],
      [
        input.expiryDays === 0,
        "expiryDays",
        "admin.coins.settings.validation.expiry_days_required",
      ],
      [
        input.issuerName === "",
        "issuerName",
        "admin.coins.settings.validation.issuer_name_required",
      ],
      [
        input.termsUrl === "",
        "termsUrl",
        "admin.coins.settings.validation.terms_url_required",
      ],
      [
        input.contact === "",
        "contact",
        "admin.coins.settings.validation.contact_required",
      ],
      [
        input.notice === "",
        "notice",
        "admin.coins.settings.validation.notice_required",
      ],
    ] as const;

    for (const [missing, field, message] of required) {
      if (missing && !fieldErrors[field]) {
        fieldErrors[field] = t(message);
      }
    }
  }

  if (Object.keys(fieldErrors).length > 0 || !coinUnitAmount.ok) {
    return { fieldErrors, message: t("errors.validation"), ok: false };
  }

  const result = await withAdminSessionReauth(() =>
    updateCoinSettings(
      {
        coinName: coinNameOrFallback(input.coinName, t),
        currency: coinUnitAmount.currency,
        defaultLocale: locales.defaultLocale,
        settings: {
          coinUnitAmount: coinUnitAmount.value,
          contact: input.contact,
          enabled: input.enabled,
          expiryDays: input.expiryDays,
          issuerName: input.issuerName,
          names,
          notice: input.notice,
          selling: input.selling,
          termsUrl: input.termsUrl,
        },
        tenantId: input.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      message: result.message,
      ok: false,
    };
  }

  updateTag(coinsCacheTag(input.tenantId));

  return { message: t("admin.coins.settings.saved"), ok: true };
};

const packFieldsSchema = (t: AdminMessageAccessor, coinName: string) =>
  z.object({
    bonusCoins: nonNegativeIntFormSchema(
      t("admin.coins.packs.validation.bonus_coins_invalid", {
        coin_name: coinName,
      })
    ),
    coins: z.preprocess(
      (value) => {
        const raw = isFormText(value) ? value.trim() : "";

        return /^\d+$/u.test(raw) ? Number(raw) : undefined;
      },
      z
        .number({
          error: t("admin.coins.packs.validation.coins_invalid", {
            coin_name: coinName,
          }),
        })
        .int()
        .min(
          1,
          t("admin.coins.packs.validation.coins_invalid", {
            coin_name: coinName,
          })
        )
        .max(
          MAX_INT32,
          t("admin.coins.packs.validation.coins_invalid", {
            coin_name: coinName,
          })
        )
    ),
    onSale: checkboxOnFormSchema,
    price: rawPriceFormSchema,
    priceCurrency: optionalTrimmedString(),
  });

const packFormFields = {
  bonusCoins: { kind: "value", name: "bonus_coins" },
  coins: "value",
  onSale: { kind: "value", name: "on_sale" },
  price: "value",
  priceCurrency: { kind: "value", name: "price_currency" },
} as const;

const rowFormFields = {
  coinName: { kind: "value", name: "coin_name" },
  id: { kind: "value", name: "coin_pack_id" },
  tenantId: { kind: "value", name: "tenant_id" },
} as const;

/**
 * The coins, the bonus, and the price a pack form posted, with the price read
 * in the tenant's currency. A pack is never free, and the API refuses one
 * whose coins and bonus together pass what it counts in.
 */
const parsePackFields = async (
  formData: FormData,
  tenantId: string,
  coinName: string,
  locale: Locale,
  t: AdminMessageAccessor
): Promise<
  | {
      ok: true;
      pack: {
        bonusCoins: number;
        coins: number;
        currency: string;
        onSale: boolean;
        price: number;
      };
    }
  | { ok: false; message: string }
> => {
  const parsed = packFieldsSchema(t, coinName).safeParse(
    toFormDataInput(formData, packFormFields)
  );

  if (!parsed.success) {
    return {
      message: toFormErrorMessage(parsed.error, { locale }),
      ok: false,
    };
  }

  const { bonusCoins, coins, onSale } = parsed.data;

  if (coins + bonusCoins > MAX_INT32) {
    return {
      message: t("admin.coins.packs.validation.total_too_large", {
        coin_name: coinName,
      }),
      ok: false,
    };
  }

  const price = await parseTenantPrice(
    parsed.data.price,
    parsed.data.priceCurrency,
    tenantId,
    locale,
    "admin.coins.packs.validation.price_invalid"
  );

  if (!price.ok) {
    return price;
  }

  if (price.value <= 0) {
    return {
      message: t("admin.coins.packs.validation.price_invalid"),
      ok: false,
    };
  }

  return {
    ok: true,
    pack: {
      bonusCoins,
      coins,
      currency: price.currency,
      onSale,
      price: price.value,
    },
  };
};

/** Adds a pack after the tenant's other packs. */
export const createCoinPackAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      coinName: optionalTrimmedString(),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .safeParse(
      toFormDataInput(formData, {
        coinName: rowFormFields.coinName,
        tenantId: rowFormFields.tenantId,
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { tenantId } = parsed.data;
  const coinName = coinNameOrFallback(parsed.data.coinName, t);

  const fields = await parsePackFields(formData, tenantId, coinName, locale, t);

  if (!fields.ok) {
    return { message: fields.message, ok: false };
  }

  const result = await withAdminSessionReauth(async () => {
    const current = await readCoinPacksForWrite(tenantId, locale);

    if (!current.ok) {
      return current;
    }

    if (current.packs.length >= COIN_PACK_LIMIT) {
      return {
        message: t("admin.coins.packs.validation.limit", {
          count: COIN_PACK_LIMIT,
        }),
        ok: false as const,
      };
    }

    const sortOrder =
      Math.max(-1, ...current.packs.map((pack) => pack.sortOrder)) + 1;

    return createCoinPack(
      { coinName, pack: { ...fields.pack, sortOrder }, tenantId },
      locale
    );
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(coinsCacheTag(tenantId));

  return { message: t("admin.coins.packs.created"), ok: true };
};

/**
 * Saves a pack's row. A pack that has been sold keeps the coins, the bonus,
 * and the price a purchase of it bought, so only whether it is on sale is read
 * from its form; every pack keeps the place it holds in the list.
 */
export const updateCoinPackAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      coinName: optionalTrimmedString(),
      id: requiredRecordId(t("admin.coins.packs.not_found")),
      onSale: checkboxOnFormSchema,
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .safeParse(
      toFormDataInput(formData, {
        ...rowFormFields,
        onSale: packFormFields.onSale,
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, onSale, tenantId } = parsed.data;
  const coinName = coinNameOrFallback(parsed.data.coinName, t);

  const result = await withAdminSessionReauth(async () => {
    const current = await readCoinPacksForWrite(tenantId, locale);

    if (!current.ok) {
      return current;
    }

    const stored = current.packs.find((pack) => pack.id === id);

    if (!stored) {
      return { message: t("admin.coins.packs.not_found"), ok: false as const };
    }

    if (stored.sold) {
      return updateCoinPack(
        {
          coinName,
          id,
          pack: { ...stored, currency: "", onSale },
          tenantId,
        },
        locale
      );
    }

    const fields = await parsePackFields(
      formData,
      tenantId,
      coinName,
      locale,
      t
    );

    if (!fields.ok) {
      return fields;
    }

    return updateCoinPack(
      {
        coinName,
        id,
        pack: { ...fields.pack, sortOrder: stored.sortOrder },
        tenantId,
      },
      locale
    );
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(coinsCacheTag(tenantId));

  return { message: t("admin.coins.packs.updated"), ok: true };
};

export const retireCoinPackAction = async (
  _prevState: ActionForm.State,
  formData: FormData
): Promise<ActionForm.State> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      id: requiredRecordId(t("admin.coins.packs.not_found")),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .safeParse(
      toFormDataInput(formData, {
        id: rowFormFields.id,
        tenantId: rowFormFields.tenantId,
      })
    );

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const { id, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    retireCoinPack({ id, tenantId }, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(coinsCacheTag(tenantId));

  return { message: t("admin.coins.packs.retired"), ok: true };
};

export const reorderCoinPacksAction = async (
  formData: FormData
): Promise<CoinPackReorderResult> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);

  const parsed = z
    .object({
      expectedIds: jsonRecordIdArrayFormSchema,
      ids: jsonRecordIdArrayFormSchema,
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .safeParse(
      toFormDataInput(formData, {
        expectedIds: { kind: "value", name: "expected_coin_pack_ids" },
        ids: { kind: "value", name: "coin_pack_ids" },
        tenantId: rowFormFields.tenantId,
      })
    );

  if (!parsed.success || parsed.data.ids.length === 0) {
    return { message: t("admin.coins.packs.reorder_failed"), ok: false };
  }

  const { expectedIds, ids, tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    reorderCoinPacks({ expectedIds, ids, tenantId }, locale)
  );

  // A reorder that failed part of the way has still moved some packs.
  updateTag(coinsCacheTag(tenantId));

  return result.ok ? { ok: true } : { message: result.message, ok: false };
};
