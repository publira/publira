"use server";

import { z } from "zod";

import {
  sendTenantSmtpTestEmail,
  updateTenantEmailSettings,
} from "../../../../../lib/email-settings";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "../../../../../lib/email-settings-shared";
import { updateTenantSiteSettings } from "../../../../../lib/site-settings";
import { updateTenantThemeSettings } from "../../../../../lib/theme-settings";
import type {
  SiteSettingsActionState,
  ThemeSettingsActionState,
  TenantEmailSettingsFormState,
  TenantSmtpTestFormState,
} from "../settings-types";

interface ParsedTenantSmtpFormData {
  tenantPublicId: string;
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

const hexColorCodeSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "#RRGGBB 形式で入力してください。")
  .transform((value) => value.toLowerCase());

const tenantThemeSchema = z.object({
  accentColor: hexColorCodeSchema,
  primaryColor: hexColorCodeSchema,
  secondaryColor: hexColorCodeSchema,
});

const parseIntOrFallback = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
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
  tenantPublicId: String(formData.get("tenant_public_id") ?? "").trim(),
  username: String(formData.get("username") ?? "").trim(),
});

export const updateSiteSettingsAction = async (
  _prevState: SiteSettingsActionState,
  formData: FormData
): Promise<SiteSettingsActionState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const copyrightText = String(formData.get("copyright_text") ?? "");
  const siteDescription = String(formData.get("site_description") ?? "");
  const siteTagline = String(formData.get("site_tagline") ?? "");

  if (!tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await updateTenantSiteSettings({
    copyrightText,
    siteDescription,
    siteTagline,
    tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: "設定を保存しました。",
    ok: true,
  };
};

export const updateTenantThemeSettingsAction = async (
  _prevState: ThemeSettingsActionState,
  formData: FormData
): Promise<ThemeSettingsActionState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  if (!tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const parsed = tenantThemeSchema.safeParse({
    accentColor: String(formData.get("accent_color") ?? ""),
    primaryColor: String(formData.get("primary_color") ?? ""),
    secondaryColor: String(formData.get("secondary_color") ?? ""),
  });

  if (!parsed.success) {
    const flatten = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        accentColor: flatten.accentColor?.[0],
        primaryColor: flatten.primaryColor?.[0],
        secondaryColor: flatten.secondaryColor?.[0],
      },
      message: "入力内容を確認してください。",
      ok: false,
    };
  }

  const result = await updateTenantThemeSettings({
    accentColor: parsed.data.accentColor,
    primaryColor: parsed.data.primaryColor,
    secondaryColor: parsed.data.secondaryColor,
    tenantPublicId,
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: "テーマを保存しました。",
    ok: true,
    theme: result.theme,
  };
};

export const updateTenantEmailSettingsAction = async (
  _prevState: TenantEmailSettingsFormState,
  formData: FormData
): Promise<TenantEmailSettingsFormState> => {
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await updateTenantEmailSettings(input);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: "メール設定を保存しました。",
    ok: true,
    settings: result.settings,
  };
};

export const sendTenantSmtpTestEmailAction = async (
  _prevState: TenantSmtpTestFormState,
  formData: FormData
): Promise<TenantSmtpTestFormState> => {
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await sendTenantSmtpTestEmail(input);
  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message: `接続テストメールを送信しました（送信先: ${result.recipientEmail}）。`,
    ok: true,
    recipientEmail: result.recipientEmail,
  };
};
