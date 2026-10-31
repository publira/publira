"use server";

import type { Locale } from "@publira/i18n";
import { toFieldErrors, toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { getActionLocale } from "#lib/action-messages";
import { withAdminSessionReauth } from "#lib/auth-session";
import { assertSameOrigin } from "#lib/csrf";
import {
  sendTenantSmtpTestEmail,
  tenantEmailSettingsCacheTag,
  updateTenantEmailSettings,
} from "#lib/email-settings";
import {
  SECRET_UPDATE_MODE_CLEAR,
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import {
  checkboxOnFormSchema,
  isFormText,
  optionalBoundedIntFormSchema,
  optionalTrimmedString,
  requiredTrimmedString,
} from "#lib/form-schemas";
import {
  getInboundEmailProvider,
  tenantInboundEmailSettingsCacheTag,
  updateTenantInboundEmailSettings,
} from "#lib/inbound-email-settings";
import { getMessagesFor } from "#lib/messages";
import { toProviderCredentialUpdates } from "#lib/provider-credential-form";

import type {
  TenantEmailSettingsFormState,
  TenantInboundEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../email-types";

/**
 * A mode the form does not post keeps the stored password, so a malformed
 * value can never remove it.
 */
const secretUpdateModeFormSchema = z.preprocess((value) => {
  const raw = isFormText(value) ? value.trim() : "";

  if (raw === String(SECRET_UPDATE_MODE_REPLACE)) {
    return SECRET_UPDATE_MODE_REPLACE;
  }

  return raw === String(SECRET_UPDATE_MODE_CLEAR)
    ? SECRET_UPDATE_MODE_CLEAR
    : SECRET_UPDATE_MODE_UNCHANGED;
}, z.number());

const recipientTypeFormSchema = z.preprocess((value) => {
  const raw = isFormText(value) ? value.trim() : "";

  return raw === String(TEST_EMAIL_RECIPIENT_TYPE_CUSTOM)
    ? TEST_EMAIL_RECIPIENT_TYPE_CUSTOM
    : TEST_EMAIL_RECIPIENT_TYPE_SELF;
}, z.number());

/**
 * The SMTP form, which a save and the connection test both post. The fields
 * are closed, and so not posted, while the override is off; whether they hold
 * settings that can send is the API's to say.
 */
const tenantSmtpFormSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z.object({
    encryption: z.preprocess(
      (value) => (isFormText(value) ? value.trim().toLowerCase() : ""),
      z.string()
    ),
    fromAddress: optionalTrimmedString(),
    fromName: optionalTrimmedString(),
    host: optionalTrimmedString(),
    password: z.preprocess(
      (value) => (isFormText(value) ? value : ""),
      z.string()
    ),
    passwordUpdateMode: secretUpdateModeFormSchema,
    // Absent is 0, which the API reads as no port given.
    port: optionalBoundedIntFormSchema(t("admin.settings.email.port_invalid"), {
      max: 65_535,
      min: 1,
    }).transform((port) => port ?? 0),
    recipientEmail: optionalTrimmedString(),
    recipientType: recipientTypeFormSchema,
    replyTo: optionalTrimmedString(),
    smtpOverrideEnabled: checkboxOnFormSchema,
    tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    username: optionalTrimmedString(),
  });
};

const tenantSmtpFormFields = {
  encryption: "value",
  fromAddress: { kind: "value", name: "from_address" },
  fromName: { kind: "value", name: "from_name" },
  host: "value",
  password: "value",
  passwordUpdateMode: { kind: "value", name: "password_update_mode" },
  port: "value",
  recipientEmail: { kind: "value", name: "recipient_email" },
  recipientType: { kind: "value", name: "recipient_type" },
  replyTo: { kind: "value", name: "reply_to" },
  smtpOverrideEnabled: { kind: "value", name: "smtp_override_enabled" },
  tenantId: { kind: "value", name: "tenant_id" },
  username: "value",
} as const;

const parseTenantSmtpFormData = async (formData: FormData, locale: Locale) => {
  const schema = await tenantSmtpFormSchema(locale);

  return schema.safeParse(toFormDataInput(formData, tenantSmtpFormFields));
};

export const updateTenantEmailSettingsAction = async (
  _prevState: TenantEmailSettingsFormState,
  formData: FormData
): Promise<TenantEmailSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parseTenantSmtpFormData(formData, locale),
  ]);

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const input = parsed.data;

  const result = await withAdminSessionReauth(() =>
    updateTenantEmailSettings(input, locale)
  );

  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      message: result.message,
      ok: false,
    };
  }

  updateTag(tenantEmailSettingsCacheTag(input.tenantId));

  return {
    message: t("admin.settings.email.saved"),
    ok: true,
    settings: result.settings,
  };
};

export const sendTenantSmtpTestEmailAction = async (
  _prevState: TenantSmtpTestFormState,
  formData: FormData
): Promise<TenantSmtpTestFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, parsed] = await Promise.all([
    getMessagesFor(locale),
    parseTenantSmtpFormData(formData, locale),
  ]);

  if (!parsed.success) {
    return { message: toFormErrorMessage(parsed.error, { locale }), ok: false };
  }

  const input = parsed.data;

  const result = await withAdminSessionReauth(() =>
    sendTenantSmtpTestEmail(input, locale)
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: t("admin.settings.email.test_sent", {
      recipient: result.recipientEmail,
    }),
    ok: true,
    recipientEmail: result.recipientEmail,
  };
};

/**
 * The longest inbound domain the API stores: the per-message address
 * `contact+<public id>@<domain>` has to fit in a 254-byte mailbox.
 */
const MAX_INBOUND_DOMAIN_LENGTH = 233;

const tenantInboundEmailSettingsSchema = async (locale: Locale) => {
  const t = await getMessagesFor(locale);

  return z
    .object({
      domain: optionalTrimmedString(
        MAX_INBOUND_DOMAIN_LENGTH,
        t("admin.settings.inbound_email.validation.domain_invalid")
      ),
      enabled: checkboxOnFormSchema,
      provider: requiredTrimmedString(
        t("admin.settings.inbound_email.validation.provider_invalid")
      ),
      tenantId: requiredTrimmedString(t("admin.settings.tenant_missing")),
    })
    .superRefine((input, context) => {
      if (input.enabled && input.domain === "") {
        context.addIssue({
          code: "custom",
          message: t("admin.settings.inbound_email.validation.domain_required"),
          path: ["domain"],
        });
      }
    });
};

export const updateTenantInboundEmailSettingsAction = async (
  _prevState: TenantInboundEmailSettingsFormState,
  formData: FormData
): Promise<TenantInboundEmailSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);

  const [t, schema] = await Promise.all([
    getMessagesFor(locale),
    tenantInboundEmailSettingsSchema(locale),
  ]);

  const parsed = schema.safeParse(
    toFormDataInput(formData, {
      domain: "value",
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
    getInboundEmailProvider(parsed.data.tenantId, parsed.data.provider, locale)
  );

  if (!declared.ok) {
    return { message: declared.message, ok: false };
  }

  const credentials = toProviderCredentialUpdates(
    formData,
    declared.provider.fields,
    {
      enabled: parsed.data.enabled,
      requiredMessage: t(
        "admin.settings.inbound_email.validation.field_required"
      ),
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
    updateTenantInboundEmailSettings(
      {
        domain: parsed.data.domain,
        enabled: parsed.data.enabled,
        fields: credentials.fields,
        provider: declared.provider.id,
        tenantId: parsed.data.tenantId,
      },
      locale
    )
  );

  if (!result.ok) {
    return result.domainInvalid
      ? {
          fieldErrors: {
            domain: t("admin.settings.inbound_email.validation.domain_invalid"),
          },
          message: result.message,
          ok: false,
        }
      : { message: result.message, ok: false };
  }

  updateTag(tenantInboundEmailSettingsCacheTag(parsed.data.tenantId));

  return {
    message: t("admin.settings.inbound_email.saved"),
    ok: true,
  };
};
