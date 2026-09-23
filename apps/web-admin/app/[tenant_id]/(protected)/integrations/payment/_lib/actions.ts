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
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "#lib/email-settings-shared";
import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  optionalHttpsUrlFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  tenantPaymentSettingsCacheTag,
  updateTenantPaymentSettings,
} from "#lib/payment-settings";
import { SURFACE_AVAILABILITIES } from "#lib/surface-availability";
import {
  tenantPurchaseSettingsCacheTag,
  updateTenantPurchaseSettings,
} from "#lib/tenant-purchase-settings";

import type {
  TenantPaymentSettingsFormState,
  TenantPurchaseSettingsFormState,
} from "../payment-types";

const optionalSecretSchema = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.string()
);

const tenantPaymentSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      enabled: checkboxOnFormSchema,
      secretKey: optionalSecretSchema,
      secretKeyConfigured: flagOneFormSchema,
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
      webhookSecret: optionalSecretSchema,
      webhookSecretConfigured: flagOneFormSchema,
    })
    .superRefine((value, ctx) => {
      if (!value.enabled) {
        return;
      }
      if (!value.secretKeyConfigured && value.secretKey.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: t("admin.settings.payment.validation.secret_key_required"),
          path: ["secretKey"],
        });
      }
      if (!value.webhookSecretConfigured && value.webhookSecret.trim() === "") {
        ctx.addIssue({
          code: "custom",
          message: t(
            "admin.settings.payment.validation.webhook_secret_required"
          ),
          path: ["webhookSecret"],
        });
      }
    });
};
const tenantPaymentSettingsFormFields = {
  enabled: "value",
  secretKey: { kind: "value", name: "secret_key" },
  secretKeyConfigured: { kind: "value", name: "secret_key_configured" },
  tenantId: { kind: "value", name: "tenant_id" },
  webhookSecret: { kind: "value", name: "webhook_secret" },
  webhookSecretConfigured: {
    kind: "value",
    name: "webhook_secret_configured",
  },
} as const;

const secretUpdateMode = (value: string): number =>
  value.trim() === ""
    ? SECRET_UPDATE_MODE_UNCHANGED
    : SECRET_UPDATE_MODE_REPLACE;

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
    toFormDataInput(formData, tenantPaymentSettingsFormFields)
  );
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const secretKey = parsed.data.secretKey.trim();
  const webhookSecret = parsed.data.webhookSecret.trim();

  const result = await withAdminSessionReauth(() =>
    updateTenantPaymentSettings(
      {
        enabled: parsed.data.enabled,
        secretKey,
        secretKeyUpdateMode: secretUpdateMode(secretKey),
        tenantId: parsed.data.tenantId,
        webhookSecret,
        webhookSecretUpdateMode: secretUpdateMode(webhookSecret),
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
    settings: result.settings,
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
    settings: result.settings,
  };
};
