"use server";

import type { Locale } from "@publira/i18n";
import { toFieldErrors } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  isFormText,
  optionalHttpsUrlFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import type { AdminMessageAccessor } from "#lib/messages";
import {
  getPaymentProvider,
  removeTenantPaymentProvider,
  tenantPaymentSettingsCacheTag,
  updateTenantPaymentSettings,
  upsertTenantPaymentProvider,
} from "#lib/payment-settings";
import type { UpdateTenantPaymentSettingsInput } from "#lib/payment-settings";
import { toProviderCredentialUpdates } from "#lib/provider-credential-form";
import { getTenantCurrency, tenantSiteCacheTag } from "#lib/public-api";
import {
  hasSecretKey,
  secretKeyFormInput,
  secretKeySchema,
  toSecretKeyUpdate,
} from "#lib/secret-key-form";
import {
  tenantStorePaymentSettingsCacheTag,
  updateTenantStorePaymentSettings,
} from "#lib/store-payment-settings";
import { APP_PURCHASE_ROUTES } from "#lib/store-payment-settings-shared";
import { SURFACE_AVAILABILITIES } from "#lib/surface-availability";
import {
  tenantPurchaseSettingsCacheTag,
  updateTenantPurchaseSettings,
  updateTenantTipSettings,
} from "#lib/tenant-purchase-settings";
import {
  MAX_TIP_AMOUNTS,
  parseTipAmounts,
} from "#lib/tenant-tip-settings-shared";
import type { TipAmountsResult } from "#lib/tenant-tip-settings-shared";

import type {
  TenantPaymentProviderRemoveFormState,
  TenantPaymentSettingsFormState,
  TenantPurchaseSettingsFormState,
  TenantStorePaymentSettingsFormState,
  TenantTipSettingsFormState,
} from "../payment-types";

const optionalSecretSchema = z.preprocess(
  (value) => (isFormText(value) ? value : ""),
  z.string()
);

const tenantPaymentSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    // Absent while the select is locked, which keeps the stored currency.
    currency: z.preprocess(
      (value) => (isFormText(value) ? value.trim() : ""),
      z.string()
    ),
    enabled: checkboxOnFormSchema,
    provider: requiredTrimmedString(
      t("admin.settings.payment.validation.provider_invalid")
    ),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

/**
 * Reads a save of one provider's settings and checks it against the provider
 * the server registers under the id it names, then hands it to `save`: the
 * single-provider settings of the release before, or one of the providers the
 * tenant holds.
 */
const saveProviderSettings = async (
  formData: FormData,
  save: (
    input: UpdateTenantPaymentSettingsInput,
    locale: Locale
  ) => Promise<{ ok: true } | { ok: false; message: string }>,
  saved: (t: AdminMessageAccessor, provider: string) => string
): Promise<TenantPaymentSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantPaymentSettingsSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      currency: "value",
      enabled: "value",
      provider: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const declared = await withAdminSessionReauth(() =>
    getPaymentProvider(parsed.data.tenantId, parsed.data.provider, locale)
  );

  if (!declared.ok) {
    return { message: declared.message, ok: false };
  }

  const { currency } = parsed.data;

  if (currency && !declared.provider.currencies.includes(currency)) {
    return {
      fieldErrors: {
        currency: t("admin.settings.payment.validation.currency_invalid"),
      },
      message: t("errors.validation"),
      ok: false,
    };
  }

  const credentials = toProviderCredentialUpdates(
    formData,
    declared.provider.fields,
    {
      enabled: parsed.data.enabled,
      requiredMessage: t("admin.settings.payment.validation.field_required"),
    }
  );

  if (!credentials.ok) {
    return {
      fieldErrors: credentials.fieldErrors,
      message: t("errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    save(
      {
        currency,
        enabled: parsed.data.enabled,
        fields: credentials.fields,
        provider: declared.provider.id,
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

  updateTag(tenantPaymentSettingsCacheTag(parsed.data.tenantId));
  // The currency every price on the console is shown and entered in is read
  // from the public tenant read.
  updateTag(tenantSiteCacheTag(parsed.data.tenantId));

  return {
    message: saved(t, declared.provider.displayName),
    ok: true,
  };
};

/** The single-provider form a server of the release before is answered with. */
export const updateTenantPaymentSettingsAction = async (
  _prevState: TenantPaymentSettingsFormState,
  formData: FormData
): Promise<TenantPaymentSettingsFormState> =>
  await saveProviderSettings(formData, updateTenantPaymentSettings, (t) =>
    t("admin.settings.payment.saved")
  );

/** Adds a provider beside the ones the tenant holds. */
export const addTenantPaymentProviderAction = async (
  _prevState: TenantPaymentSettingsFormState,
  formData: FormData
): Promise<TenantPaymentSettingsFormState> =>
  await saveProviderSettings(
    formData,
    upsertTenantPaymentProvider,
    (t, provider) => t("admin.settings.payment.provider_added", { provider })
  );

/** Saves one of the providers the tenant holds, leaving the others alone. */
export const saveTenantPaymentProviderAction = async (
  _prevState: TenantPaymentSettingsFormState,
  formData: FormData
): Promise<TenantPaymentSettingsFormState> =>
  await saveProviderSettings(
    formData,
    upsertTenantPaymentProvider,
    (t, provider) => t("admin.settings.payment.provider_saved", { provider })
  );

const removePaymentProviderSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    provider: requiredTrimmedString(
      t("admin.settings.payment.validation.provider_invalid")
    ),
    // Whether the card asked to delete a provider removed before, which only
    // decides which sentence describes a provider that stays removed.
    retired: flagOneFormSchema,
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

/**
 * Removes one of the providers the tenant holds, or deletes one it removed
 * before once nothing it took can still be refunded.
 */
export const removeTenantPaymentProviderAction = async (
  _prevState: TenantPaymentProviderRemoveFormState,
  formData: FormData
): Promise<TenantPaymentProviderRemoveFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    removePaymentProviderSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      provider: "value",
      retired: "value",
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: t("errors.validation"), ok: false };
  }

  const { tenantId } = parsed.data;

  const result = await withAdminSessionReauth(() =>
    removeTenantPaymentProvider(
      { provider: parsed.data.provider, tenantId },
      locale
    )
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  updateTag(tenantPaymentSettingsCacheTag(tenantId));

  // The name is only the message's: a provider this build no longer
  // registers is still one the tenant can remove.
  const declared = await withAdminSessionReauth(() =>
    getPaymentProvider(tenantId, parsed.data.provider, locale)
  );

  const provider = declared.ok
    ? declared.provider.displayName
    : parsed.data.provider;

  if (!result.retired) {
    return {
      message: t("admin.settings.payment.provider_deleted", { provider }),
      ok: true,
    };
  }

  return {
    message: parsed.data.retired
      ? t("admin.settings.payment.provider_kept", { provider })
      : t("admin.settings.payment.provider_removed", { provider }),
    ok: true,
  };
};

const tenantPurchaseSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    appStoreUrl: optionalHttpsUrlFormSchema(
      t("admin.settings.purchase.validation.app_store_url_invalid")
    ),
    googlePlayUrl: optionalHttpsUrlFormSchema(
      t("admin.settings.purchase.validation.google_play_url_invalid")
    ),
    purchaseAvailability: z.enum(SURFACE_AVAILABILITIES, {
      error: t("admin.settings.purchase.validation.availability_invalid"),
    }),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const updateTenantPurchaseSettingsAction = async (
  _prevState: TenantPurchaseSettingsFormState,
  formData: FormData
): Promise<TenantPurchaseSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantPurchaseSettingsSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      appStoreUrl: { kind: "value", name: "app_store_url" },
      googlePlayUrl: { kind: "value", name: "google_play_url" },
      purchaseAvailability: { kind: "value", name: "purchase_availability" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantPurchaseSettings(parsed.data, locale)
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The settings screen and the series and episode forms that name the default
  // read it through a private cache. The storefront's copies are dropped by the
  // API as the update lands.
  updateTag(tenantPurchaseSettingsCacheTag(parsed.data.tenantId));

  return {
    message: t("admin.settings.purchase.saved"),
    ok: true,
  };
};

const tenantTipSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    // Read once the tenant's currency is known.
    amounts: z.array(z.string()),
    // The currency the form showed the amounts in.
    amountsCurrency: z.preprocess(
      (value) => (isFormText(value) ? value.trim() : ""),
      z.string()
    ),
    enabled: checkboxOnFormSchema,
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

/** What the card says of amounts {@link parseTipAmounts} refused. */
const tipAmountsMessage = (
  result: Extract<TipAmountsResult, { ok: false }>,
  t: AdminMessageAccessor
): string => {
  switch (result.reason) {
    case "amount_invalid": {
      return t("admin.settings.tips.validation.amount_invalid", {
        amount: result.amount,
      });
    }

    case "duplicate": {
      return t("admin.settings.tips.validation.amount_duplicate", {
        amount: result.amount,
      });
    }

    case "too_many": {
      return t("admin.settings.tips.validation.too_many", {
        max: MAX_TIP_AMOUNTS,
      });
    }

    default: {
      return t("admin.settings.tips.validation.amounts_required");
    }
  }
};

export const updateTenantTipSettingsAction = async (
  _prevState: TenantTipSettingsFormState,
  formData: FormData
): Promise<TenantTipSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantTipSettingsSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      amounts: { kind: "values", name: "tip_amounts" },
      amountsCurrency: { kind: "value", name: "tip_amounts_currency" },
      enabled: { kind: "value", name: "tips_enabled" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );

  if (!parsed.success) {
    return { message: t("errors.validation"), ok: false };
  }

  const { amountsCurrency, enabled, tenantId } = parsed.data;
  // Read in the currency the tenant sells in now, never one the form claims.
  // A form opened before it changed was typed in the old one.
  const currency = await getTenantCurrency(tenantId);

  if (!currency) {
    return {
      message: t("admin.settings.tips.currency_unavailable"),
      ok: false,
    };
  }

  if (amountsCurrency !== currency) {
    return {
      message: t("admin.settings.tips.currency_changed"),
      ok: false,
    };
  }

  const amounts = parseTipAmounts(parsed.data.amounts, currency, enabled);

  if (!amounts.ok) {
    return {
      fieldErrors: { tipAmounts: tipAmountsMessage(amounts, t) },
      message: t("errors.validation"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantTipSettings(
      { tenantId, tips: { amounts: amounts.amounts, enabled } },
      locale
    )
  );

  if (!result.ok) {
    return {
      fieldErrors: result.tipAmountsError
        ? { tipAmounts: result.tipAmountsError }
        : undefined,
      message: result.message,
      ok: false,
    };
  }

  // The tips are read with the rest of the purchase settings, under their tag.
  // Store products are read uncached, and the storefront's copies are dropped
  // by the API as the update lands.
  updateTag(tenantPurchaseSettingsCacheTag(tenantId));

  return {
    message: t("admin.settings.tips.saved"),
    ok: true,
  };
};

const tenantStorePaymentSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  const fileTooLarge = t(
    "admin.settings.store_payment.validation.key_file_too_large"
  );

  return z
    .object({
      appPurchaseRoute: z.enum(APP_PURCHASE_ROUTES, {
        error: t("admin.settings.store_payment.validation.route_invalid"),
      }),
      appStoreEnabled: checkboxOnFormSchema,
      googlePlayEnabled: checkboxOnFormSchema,
      issuerId: optionalSecretSchema.transform((value) => value.trim()),
      keyId: optionalSecretSchema.transform((value) => value.trim()),
      privateKey: secretKeySchema(fileTooLarge),
      serviceAccountKey: secretKeySchema(fileTooLarge),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .superRefine((value, ctx) => {
      if (value.appStoreEnabled) {
        if (value.issuerId === "") {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.store_payment.validation.issuer_id_required"
            ),
            path: ["issuerId"],
          });
        }

        if (value.keyId === "") {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.store_payment.validation.key_id_required"
            ),
            path: ["keyId"],
          });
        }

        if (!hasSecretKey(value.privateKey)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.store_payment.validation.private_key_required"
            ),
            path: ["privateKey"],
          });
        }
      }

      if (value.googlePlayEnabled && !hasSecretKey(value.serviceAccountKey)) {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.store_payment.validation.service_account_key_required"
          ),
          path: ["serviceAccountKey"],
        });
      }
    });
};

export const updateTenantStorePaymentSettingsAction = async (
  _prevState: TenantStorePaymentSettingsFormState,
  formData: FormData
): Promise<TenantStorePaymentSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantStorePaymentSettingsSchema(locale),
  ]);

  const parsed = schema.safeParse({
    ...toFormDataInput(formData, {
      appPurchaseRoute: { kind: "value", name: "app_purchase_route" },
      appStoreEnabled: { kind: "value", name: "app_store_enabled" },
      googlePlayEnabled: { kind: "value", name: "google_play_enabled" },
      issuerId: { kind: "value", name: "issuer_id" },
      keyId: { kind: "value", name: "key_id" },
      tenantId: { kind: "value", name: "tenant_id" },
    }),
    privateKey: secretKeyFormInput(formData, "private_key"),
    serviceAccountKey: secretKeyFormInput(formData, "service_account_key"),
  });

  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const [privateKey, serviceAccountKey] = await Promise.all([
    toSecretKeyUpdate(parsed.data.privateKey),
    toSecretKeyUpdate(parsed.data.serviceAccountKey),
  ]);

  const result = await withAdminSessionReauth(() =>
    updateTenantStorePaymentSettings(
      {
        appPurchaseRoute: parsed.data.appPurchaseRoute,
        appStore: {
          enabled: parsed.data.appStoreEnabled,
          issuerId: parsed.data.issuerId,
          keyId: parsed.data.keyId,
          privateKey,
        },
        googlePlay: {
          enabled: parsed.data.googlePlayEnabled,
          serviceAccountKey,
        },
        tenantId: parsed.data.tenantId,
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

  updateTag(tenantStorePaymentSettingsCacheTag(parsed.data.tenantId));

  return {
    message: t("admin.settings.store_payment.saved"),
    ok: true,
  };
};
