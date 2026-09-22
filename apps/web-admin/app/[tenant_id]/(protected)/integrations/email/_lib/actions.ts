"use server";

import { updateTag } from "next/cache";

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
import { getMessagesFor } from "#lib/messages";

import type {
  TenantEmailSettingsFormState,
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
