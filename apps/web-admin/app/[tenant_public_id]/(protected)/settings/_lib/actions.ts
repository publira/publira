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
  primaryColor: hexColorCodeSchema,
  secondaryColor: hexColorCodeSchema,
  accentColor: hexColorCodeSchema,
  backgroundColor: hexColorCodeSchema,
  foregroundColor: hexColorCodeSchema,
  surfaceColor: hexColorCodeSchema,
  surfaceForegroundColor: hexColorCodeSchema,
  cardColor: hexColorCodeSchema,
  cardForegroundColor: hexColorCodeSchema,
  popoverColor: hexColorCodeSchema,
  popoverForegroundColor: hexColorCodeSchema,
  primaryForegroundColor: hexColorCodeSchema,
  secondaryForegroundColor: hexColorCodeSchema,
  accentForegroundColor: hexColorCodeSchema,
  mutedColor: hexColorCodeSchema,
  mutedForegroundColor: hexColorCodeSchema,
  borderColor: hexColorCodeSchema,
  inputColor: hexColorCodeSchema,
  ringColor: hexColorCodeSchema,
  successColor: hexColorCodeSchema,
  successForegroundColor: hexColorCodeSchema,
  warningColor: hexColorCodeSchema,
  warningForegroundColor: hexColorCodeSchema,
  destructiveColor: hexColorCodeSchema,
  destructiveForegroundColor: hexColorCodeSchema,
  infoColor: hexColorCodeSchema,
  infoForegroundColor: hexColorCodeSchema,
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
    primaryColor: String(formData.get("primary_color") ?? ""),
    secondaryColor: String(formData.get("secondary_color") ?? ""),
    accentColor: String(formData.get("accent_color") ?? ""),
    backgroundColor: String(formData.get("background_color") ?? ""),
    foregroundColor: String(formData.get("foreground_color") ?? ""),
    surfaceColor: String(formData.get("surface_color") ?? ""),
    surfaceForegroundColor: String(formData.get("surface_foreground_color") ?? ""),
    cardColor: String(formData.get("card_color") ?? ""),
    cardForegroundColor: String(formData.get("card_foreground_color") ?? ""),
    popoverColor: String(formData.get("popover_color") ?? ""),
    popoverForegroundColor: String(formData.get("popover_foreground_color") ?? ""),
    primaryForegroundColor: String(formData.get("primary_foreground_color") ?? ""),
    secondaryForegroundColor: String(formData.get("secondary_foreground_color") ?? ""),
    accentForegroundColor: String(formData.get("accent_foreground_color") ?? ""),
    mutedColor: String(formData.get("muted_color") ?? ""),
    mutedForegroundColor: String(formData.get("muted_foreground_color") ?? ""),
    borderColor: String(formData.get("border_color") ?? ""),
    inputColor: String(formData.get("input_color") ?? ""),
    ringColor: String(formData.get("ring_color") ?? ""),
    successColor: String(formData.get("success_color") ?? ""),
    successForegroundColor: String(formData.get("success_foreground_color") ?? ""),
    warningColor: String(formData.get("warning_color") ?? ""),
    warningForegroundColor: String(formData.get("warning_foreground_color") ?? ""),
    destructiveColor: String(formData.get("destructive_color") ?? ""),
    destructiveForegroundColor: String(formData.get("destructive_foreground_color") ?? ""),
    infoColor: String(formData.get("info_color") ?? ""),
    infoForegroundColor: String(formData.get("info_foreground_color") ?? ""),
  });

  if (!parsed.success) {
    const flatten = parsed.error.flatten().fieldErrors;
    return {
      fieldErrors: {
        primaryColor: flatten.primaryColor?.[0],
        secondaryColor: flatten.secondaryColor?.[0],
        accentColor: flatten.accentColor?.[0],
        backgroundColor: flatten.backgroundColor?.[0],
        foregroundColor: flatten.foregroundColor?.[0],
        surfaceColor: flatten.surfaceColor?.[0],
        surfaceForegroundColor: flatten.surfaceForegroundColor?.[0],
        cardColor: flatten.cardColor?.[0],
        cardForegroundColor: flatten.cardForegroundColor?.[0],
        popoverColor: flatten.popoverColor?.[0],
        popoverForegroundColor: flatten.popoverForegroundColor?.[0],
        primaryForegroundColor: flatten.primaryForegroundColor?.[0],
        secondaryForegroundColor: flatten.secondaryForegroundColor?.[0],
        accentForegroundColor: flatten.accentForegroundColor?.[0],
        mutedColor: flatten.mutedColor?.[0],
        mutedForegroundColor: flatten.mutedForegroundColor?.[0],
        borderColor: flatten.borderColor?.[0],
        inputColor: flatten.inputColor?.[0],
        ringColor: flatten.ringColor?.[0],
        successColor: flatten.successColor?.[0],
        successForegroundColor: flatten.successForegroundColor?.[0],
        warningColor: flatten.warningColor?.[0],
        warningForegroundColor: flatten.warningForegroundColor?.[0],
        destructiveColor: flatten.destructiveColor?.[0],
        destructiveForegroundColor: flatten.destructiveForegroundColor?.[0],
        infoColor: flatten.infoColor?.[0],
        infoForegroundColor: flatten.infoForegroundColor?.[0],
      },
      message: "入力内容を確認してください。",
      ok: false,
    };
  }

  const result = await updateTenantThemeSettings({
    ...parsed.data,
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
