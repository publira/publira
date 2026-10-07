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
  optionalHttpsUrlFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  getPaymentProvider,
  tenantPaymentSettingsCacheTag,
  updateTenantPaymentSettings,
} from "#lib/payment-settings";
import { toProviderCredentialUpdates } from "#lib/provider-credential-form";
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
} from "#lib/tenant-purchase-settings";

import type {
  TenantPaymentSettingsFormState,
  TenantPurchaseSettingsFormState,
  TenantStorePaymentSettingsFormState,
} from "../payment-types";

const optionalSecretSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

const tenantPaymentSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    enabled: checkboxOnFormSchema,
    provider: requiredTrimmedString(
      t("admin.settings.payment.validation.provider_invalid")
    ),
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
  });
};

export const updateTenantPaymentSettingsAction = async (
  _prevState: TenantPaymentSettingsFormState,
  formData: FormData
): Promise<TenantPaymentSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantPaymentSettingsSchema(locale),
  ]);
  const parsed = schema.safeParse(
    toFormDataInput(formData, {
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
    updateTenantPaymentSettings(
      {
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

  return {
    message: t("admin.settings.payment.saved"),
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
