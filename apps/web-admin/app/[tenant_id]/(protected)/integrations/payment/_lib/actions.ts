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
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
} from "#lib/email-settings-shared";
import {
  checkboxOnFormSchema,
  flagOneFormSchema,
  optionalFileFormSchema,
  optionalHttpsUrlFormSchema,
  requiredTrimmedString,
} from "#lib/form-schemas";
import { getMessagesFor } from "#lib/messages";
import {
  tenantPaymentSettingsCacheTag,
  updateTenantPaymentSettings,
} from "#lib/payment-settings";
import {
  tenantStorePaymentSettingsCacheTag,
  updateTenantStorePaymentSettings,
} from "#lib/store-payment-settings";
import type { StoreKeyUpdate } from "#lib/store-payment-settings";
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

/** A store key file is a few kilobytes; anything far larger is not one. */
const MAX_STORE_KEY_FILE_BYTES = 64 * 1024;

/** What the form did with a stored key: kept its hint, replaced, or cleared it. */
const STORE_KEY_MODES = ["keep", "replace", "clear"] as const;

const storeKeySchema = (fileTooLarge: string) =>
  z.object({
    configured: flagOneFormSchema,
    file: optionalFileFormSchema.refine(
      (file) => file === undefined || file.size <= MAX_STORE_KEY_FILE_BYTES,
      fileTooLarge
    ),
    mode: z.enum(STORE_KEY_MODES),
    text: optionalSecretSchema,
  });

type StoreKeyInput = z.output<ReturnType<typeof storeKeySchema>>;

/** A file chosen wins over pasted text, and neither leaves the key as it is. */
const hasNewStoreKey = (key: StoreKeyInput): boolean =>
  key.mode !== "clear" && (key.file !== undefined || key.text.trim() !== "");

const hasStoreKey = (key: StoreKeyInput): boolean =>
  hasNewStoreKey(key) || (key.configured && key.mode === "keep");

const toStoreKeyUpdate = async (
  key: StoreKeyInput
): Promise<StoreKeyUpdate> => {
  if (key.mode === "clear") {
    return { mode: SECRET_UPDATE_MODE_CLEAR, value: "" };
  }
  const value = (key.file ? await key.file.text() : key.text).trim();
  return value === ""
    ? { mode: SECRET_UPDATE_MODE_UNCHANGED, value: "" }
    : { mode: SECRET_UPDATE_MODE_REPLACE, value };
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
      privateKey: storeKeySchema(fileTooLarge),
      serviceAccountKey: storeKeySchema(fileTooLarge),
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
        if (!hasStoreKey(value.privateKey)) {
          ctx.addIssue({
            code: "custom",
            message: t(
              "admin.settings.store_payment.validation.private_key_required"
            ),
            path: ["privateKey"],
          });
        }
      }
      if (value.googlePlayEnabled && !hasStoreKey(value.serviceAccountKey)) {
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

const storeKeyFormInput = (formData: FormData, name: string) =>
  toFormDataInput(formData, {
    configured: { kind: "value", name: `${name}_configured` },
    file: { kind: "file", name: `${name}_file` },
    mode: { kind: "value", name: `${name}_mode` },
    text: { kind: "value", name },
  });

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
    privateKey: storeKeyFormInput(formData, "private_key"),
    serviceAccountKey: storeKeyFormInput(formData, "service_account_key"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: toFieldErrors(parsed.error),
      message: t("errors.validation"),
      ok: false,
    };
  }

  const [privateKey, serviceAccountKey] = await Promise.all([
    toStoreKeyUpdate(parsed.data.privateKey),
    toStoreKeyUpdate(parsed.data.serviceAccountKey),
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
    settings: result.settings,
  };
};
