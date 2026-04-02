"use server";

import { z } from "zod";

import { requestAdminEmailChange } from "../../../../../lib/admin-auth";
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
import { getSessionId } from "../../../../../lib/session";
import { updateTenantSiteSettings } from "../../../../../lib/site-settings";
import { updateTenantThemeSettings } from "../../../../../lib/theme-settings";
import type {
  EmailChangeActionState,
  SiteSettingsActionState,
  ThemeSettingsActionState,
  ThemeSettingsFieldErrors,
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
  accentForegroundColor: hexColorCodeSchema,
  backgroundColor: hexColorCodeSchema,
  borderColor: hexColorCodeSchema,
  cardColor: hexColorCodeSchema,
  cardForegroundColor: hexColorCodeSchema,
  destructiveColor: hexColorCodeSchema,
  destructiveForegroundColor: hexColorCodeSchema,
  foregroundColor: hexColorCodeSchema,
  infoColor: hexColorCodeSchema,
  infoForegroundColor: hexColorCodeSchema,
  inputColor: hexColorCodeSchema,
  mutedColor: hexColorCodeSchema,
  mutedForegroundColor: hexColorCodeSchema,
  popoverColor: hexColorCodeSchema,
  popoverForegroundColor: hexColorCodeSchema,
  primaryColor: hexColorCodeSchema,
  primaryForegroundColor: hexColorCodeSchema,
  ringColor: hexColorCodeSchema,
  secondaryColor: hexColorCodeSchema,
  secondaryForegroundColor: hexColorCodeSchema,
  successColor: hexColorCodeSchema,
  successForegroundColor: hexColorCodeSchema,
  surfaceColor: hexColorCodeSchema,
  surfaceForegroundColor: hexColorCodeSchema,
  warningColor: hexColorCodeSchema,
  warningForegroundColor: hexColorCodeSchema,
});

const tenantThemeFormFieldMap = [
  ["accentColor", "accent_color"],
  ["accentForegroundColor", "accent_foreground_color"],
  ["backgroundColor", "background_color"],
  ["borderColor", "border_color"],
  ["cardColor", "card_color"],
  ["cardForegroundColor", "card_foreground_color"],
  ["destructiveColor", "destructive_color"],
  ["destructiveForegroundColor", "destructive_foreground_color"],
  ["foregroundColor", "foreground_color"],
  ["infoColor", "info_color"],
  ["infoForegroundColor", "info_foreground_color"],
  ["inputColor", "input_color"],
  ["mutedColor", "muted_color"],
  ["mutedForegroundColor", "muted_foreground_color"],
  ["popoverColor", "popover_color"],
  ["popoverForegroundColor", "popover_foreground_color"],
  ["primaryColor", "primary_color"],
  ["primaryForegroundColor", "primary_foreground_color"],
  ["ringColor", "ring_color"],
  ["secondaryColor", "secondary_color"],
  ["secondaryForegroundColor", "secondary_foreground_color"],
  ["successColor", "success_color"],
  ["successForegroundColor", "success_foreground_color"],
  ["surfaceColor", "surface_color"],
  ["surfaceForegroundColor", "surface_foreground_color"],
  ["warningColor", "warning_color"],
  ["warningForegroundColor", "warning_foreground_color"],
] as const;

type TenantThemeSchemaInput = z.input<typeof tenantThemeSchema>;

const parseTenantThemeFormData = (formData: FormData): TenantThemeSchemaInput =>
  Object.fromEntries(
    tenantThemeFormFieldMap.map(([field, formName]) => [
      field,
      String(formData.get(formName) ?? ""),
    ])
  ) as TenantThemeSchemaInput;

const mapThemeFieldErrors = (
  fieldErrors: z.ZodFlattenedError<TenantThemeSchemaInput>["fieldErrors"]
): ThemeSettingsFieldErrors =>
  Object.fromEntries(
    tenantThemeFormFieldMap.map(([field]) => [field, fieldErrors[field]?.[0]])
  ) as ThemeSettingsFieldErrors;

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

  const parsed = tenantThemeSchema.safeParse(
    parseTenantThemeFormData(formData)
  );

  if (!parsed.success) {
    return {
      fieldErrors: mapThemeFieldErrors(parsed.error.flatten().fieldErrors),
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

export const requestEmailChangeAction = async (
  _prevState: EmailChangeActionState,
  formData: FormData
): Promise<EmailChangeActionState> => {
  const tenantPublicId = String(formData.get("tenant_public_id") ?? "").trim();
  const currentEmail = String(formData.get("current_email") ?? "").trim();
  const newEmail = String(formData.get("new_email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");

  if (!tenantPublicId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  if (!currentEmail || !newEmail || !currentPassword) {
    return {
      message: "すべての項目を入力してください。",
      ok: false,
    };
  }

  const sessionId = await getSessionId();
  if (!sessionId) {
    return {
      message: "セッションが無効です。再度ログインしてください。",
      ok: false,
    };
  }

  const result = await requestAdminEmailChange(
    tenantPublicId,
    sessionId,
    currentEmail,
    newEmail,
    currentPassword
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  return {
    message:
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。",
    ok: true,
  };
};
