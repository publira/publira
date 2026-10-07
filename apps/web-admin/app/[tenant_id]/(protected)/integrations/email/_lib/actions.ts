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
  sendTenantSmtpTestEmail,
  tenantEmailSettingsCacheTag,
  updateTenantEmailSettings,
} from "#lib/email-settings";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import {
  checkboxOnFormSchema,
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

interface ParsedTenantSmtpFormData {
  tenantId: string;
  smtpOverrideEnabled: boolean;
  host: string;
  port: number;
  username: string;
  passwordUpdateMode: number;
  password: string;
  encryption: string;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  recipientType: number;
  recipientEmail: string;
}

const parseIntOrFallback = (value: string, fallback: number): number => {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
};

const parseSecretUpdateMode = (value: string): number => {
  const parsed = parseIntOrFallback(value, SECRET_UPDATE_MODE_UNCHANGED);
  if (parsed === SECRET_UPDATE_MODE_REPLACE) {
    return SECRET_UPDATE_MODE_REPLACE;
  }

  return SECRET_UPDATE_MODE_UNCHANGED;
};

const parseRecipientType = (value: string): number => {
  const parsed = parseIntOrFallback(value, TEST_EMAIL_RECIPIENT_TYPE_SELF);
  if (parsed === TEST_EMAIL_RECIPIENT_TYPE_CUSTOM) {
    return TEST_EMAIL_RECIPIENT_TYPE_CUSTOM;
  }

  return TEST_EMAIL_RECIPIENT_TYPE_SELF;
};

const parseTenantSmtpFormData = (
  formData: FormData
): ParsedTenantSmtpFormData => ({
  encryption: String(formData.get("encryption") ?? "")
    .trim()
    .toLowerCase(),
  fromAddress: String(formData.get("from_address") ?? "").trim(),
  fromName: String(formData.get("from_name") ?? "").trim(),
  host: String(formData.get("host") ?? "").trim(),
  password: String(formData.get("password") ?? ""),
  passwordUpdateMode: parseSecretUpdateMode(
    String(formData.get("password_update_mode") ?? "")
  ),
  port: parseIntOrFallback(String(formData.get("port") ?? "587"), 587),
  recipientEmail: String(formData.get("recipient_email") ?? "").trim(),
  recipientType: parseRecipientType(
    String(formData.get("recipient_type") ?? "")
  ),
  replyTo: String(formData.get("reply_to") ?? "").trim(),
  smtpOverrideEnabled: formData.get("smtp_override_enabled") === "on",
  tenantId: String(formData.get("tenant_id") ?? "").trim(),
  username: String(formData.get("username") ?? "").trim(),
});

export const updateTenantEmailSettingsAction = async (
  _prevState: TenantEmailSettingsFormState,
  formData: FormData
): Promise<TenantEmailSettingsFormState> => {
  await assertSameOrigin();
  const locale = await getActionLocale(formData);
  const t = await getMessagesFor(locale);
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantEmailSettings(input, locale)
  );
  if (!result.ok) {
    return {
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
  const t = await getMessagesFor(locale);
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantId) {
    return {
      message: t("admin.settings.tenant_missing"),
      ok: false,
    };
  }

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
