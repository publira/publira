"use server";

import { isValidTimeZone } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { updateTag } from "next/cache";
import { z } from "zod";

import { requestAdminEmailChange } from "#lib/admin-auth";
import { withAdminSessionReauth } from "#lib/auth-session";
import {
  sendTenantSmtpTestEmail,
  updateTenantEmailSettings,
} from "#lib/email-settings";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import { requiredTrimmedString } from "#lib/form-schemas";
import { updateTenantSiteSettings } from "#lib/site-settings";
import {
  tenantTimezoneCacheTag,
  updateTenantTimezone,
} from "#lib/tenant-timezone";
import {
  deleteTenantIcon,
  deleteTenantLogo,
  tenantThemeCacheTag,
  updateTenantThemeSettings,
  uploadTenantIcon,
  uploadTenantLogo,
} from "#lib/theme-settings";

import type {
  EmailChangeActionState,
  SiteSettingsActionState,
  ThemeSettingsActionState,
  ThemeSettingsFieldErrors,
  TenantEmailSettingsFormState,
  TenantIconActionState,
  TenantLogoActionState,
  TenantSmtpTestFormState,
  TenantTimezoneActionState,
} from "../settings-types";

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

const hexColorCodeSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/u, "#RRGGBB 形式で入力してください。")
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

/**
 * The Go server re-checks all of this and stays the authority. Checking size and
 * type here keeps a rejected file from being read into memory and shipped over
 * the RPC first — the `accept` attribute constrains the file picker, not a
 * request someone posts directly.
 */
const ICON_MAX_BYTES = 10 * 1024 * 1024;
const ICON_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const iconFileSchema = z
  .custom<File>((value) => value instanceof File, {
    error: "画像ファイルを選択してください。",
  })
  .refine((file) => file.size <= ICON_MAX_BYTES, {
    error: "画像は 10MB 以下にしてください。",
  })
  .refine((file) => ICON_CONTENT_TYPES.has(file.type), {
    error: "JPEG / PNG / WebP の画像を選択してください。",
  });

/**
 * Upload and delete share one Action so the card renders the current icon
 * straight from the Action state: with a state per operation there is no way to
 * tell which of the two ran last.
 */
const tenantIconSchema = z.discriminatedUnion("intent", [
  z.object({
    icon: iconFileSchema,
    intent: z.literal("upload"),
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  }),
  z.object({
    intent: z.literal("delete"),
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  }),
]);

/**
 * The logo keeps the source aspect ratio rather than being cropped, so both
 * edges have to clear the minimum instead of one square side. The size and type
 * limits match the icon's, and the Go server re-checks all of it.
 */
const LOGO_MAX_BYTES = 10 * 1024 * 1024;
const LOGO_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const logoFileSchema = z
  .custom<File>((value) => value instanceof File, {
    error: "画像ファイルを選択してください。",
  })
  .refine((file) => file.size <= LOGO_MAX_BYTES, {
    error: "画像は 10MB 以下にしてください。",
  })
  .refine((file) => LOGO_CONTENT_TYPES.has(file.type), {
    error: "JPEG / PNG / WebP の画像を選択してください。",
  });

/** Upload and delete share one Action, for the reason the icon's does. */
const tenantLogoSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("upload"),
    logo: logoFileSchema,
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  }),
  z.object({
    intent: z.literal("delete"),
    tenantId: requiredTrimmedString("テナント ID が見つかりません。"),
  }),
]);

/**
 * The Go server validates against the IANA tzdata it embeds
 * (`server/internal/tenanttz`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const tenantTimezoneSchema = z.object({
  timezone: z
    .string({ error: "タイムゾーンを選択してください。" })
    .trim()
    .min(1, "タイムゾーンを選択してください。")
    .refine(isValidTimeZone, {
      error: "有効なタイムゾーンを選択してください。",
    }),
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

export const updateSiteSettingsAction = async (
  _prevState: SiteSettingsActionState,
  formData: FormData
): Promise<SiteSettingsActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const copyrightText = String(formData.get("copyright_text") ?? "");
  const siteDescription = String(formData.get("site_description") ?? "");
  const siteTagline = String(formData.get("site_tagline") ?? "");

  if (!tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantSiteSettings({
      copyrightText,
      siteDescription,
      siteTagline,
      tenantId,
    })
  );

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
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
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

  const result = await withAdminSessionReauth(() =>
    updateTenantThemeSettings({
      ...parsed.data,
      tenantId,
    })
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Refresh SSR theme injection for this admin app (public GetTenant cache).
  updateTag(`tenant:${tenantId}:site`);
  updateTag(tenantThemeCacheTag(tenantId));

  return {
    message: "テーマを保存しました。",
    ok: true,
    theme: result.theme,
  };
};

export const updateTenantIconAction = async (
  _prevState: TenantIconActionState,
  formData: FormData
): Promise<TenantIconActionState> => {
  const parsed = tenantIconSchema.safeParse(
    toFormDataInput(formData, {
      icon: { kind: "file", name: "icon" },
      intent: { kind: "value", name: "intent" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const input = parsed.data;
  const isDelete = input.intent === "delete";

  // The file is read into memory inside the callback, so an unauthorized caller
  // never gets a 10MB upload buffered on its behalf.
  const result = await withAdminSessionReauth(async () => {
    if (input.intent === "delete") {
      return deleteTenantIcon(input.tenantId);
    }

    return uploadTenantIcon({
      iconContentType: input.icon.type,
      iconData: new Uint8Array(await input.icon.arrayBuffer()),
      tenantId: input.tenantId,
    });
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Refresh the public site's tenant read and this screen's own private cache.
  updateTag(`tenant:${input.tenantId}:site`);
  updateTag(tenantThemeCacheTag(input.tenantId));

  return {
    icon: result.icon,
    message: isDelete ? "アイコンを削除しました。" : "アイコンを保存しました。",
    ok: true,
  };
};

export const updateTenantLogoAction = async (
  _prevState: TenantLogoActionState,
  formData: FormData
): Promise<TenantLogoActionState> => {
  const parsed = tenantLogoSchema.safeParse(
    toFormDataInput(formData, {
      intent: { kind: "value", name: "intent" },
      logo: { kind: "file", name: "logo" },
      tenantId: { kind: "value", name: "tenant_id" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const input = parsed.data;
  const isDelete = input.intent === "delete";

  // The file is read into memory inside the callback, so an unauthorized caller
  // never gets a 10MB upload buffered on its behalf.
  const result = await withAdminSessionReauth(async () => {
    if (input.intent === "delete") {
      return deleteTenantLogo(input.tenantId);
    }

    return uploadTenantLogo({
      logoContentType: input.logo.type,
      logoData: new Uint8Array(await input.logo.arrayBuffer()),
      tenantId: input.tenantId,
    });
  });

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // Refresh the public site's tenant read and this screen's own private cache.
  updateTag(`tenant:${input.tenantId}:site`);
  updateTag(tenantThemeCacheTag(input.tenantId));

  return {
    logo: result.logo,
    message: isDelete ? "ロゴを削除しました。" : "ロゴを保存しました。",
    ok: true,
  };
};

export const updateTenantTimezoneAction = async (
  _prevState: TenantTimezoneActionState,
  formData: FormData
): Promise<TenantTimezoneActionState> => {
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  if (!tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const parsed = tenantTimezoneSchema.safeParse(
    toFormDataInput(formData, { timezone: "value" })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return {
      message: toFormErrorMessage(parsed.error),
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantTimezone({
      tenantId,
      timezone: parsed.data.timezone,
    })
  );

  if (!result.ok) {
    return {
      message: result.message,
      ok: false,
    };
  }

  // The settings screen reads the time zone through a private cache, so without
  // this the operator would keep seeing the previous value in the same session.
  updateTag(tenantTimezoneCacheTag(tenantId));

  return {
    message: "タイムゾーンを保存しました。",
    ok: true,
    timezone: result.timezone,
  };
};

export const updateTenantEmailSettingsAction = async (
  _prevState: TenantEmailSettingsFormState,
  formData: FormData
): Promise<TenantEmailSettingsFormState> => {
  const input = parseTenantSmtpFormData(formData);

  if (!input.tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    updateTenantEmailSettings(input)
  );
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

  if (!input.tenantId) {
    return {
      message: "テナント ID が見つかりません。",
      ok: false,
    };
  }

  const result = await withAdminSessionReauth(() =>
    sendTenantSmtpTestEmail(input)
  );
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
  const tenantId = String(formData.get("tenant_id") ?? "").trim();
  const currentEmail = String(formData.get("current_email") ?? "").trim();
  const newEmail = String(formData.get("new_email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");

  if (!tenantId) {
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

  const result = await withAdminSessionReauth(() =>
    requestAdminEmailChange(tenantId, currentEmail, newEmail, currentPassword)
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
