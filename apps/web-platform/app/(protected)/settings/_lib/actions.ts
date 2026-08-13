"use server";

import { isValidTimeZone } from "@publira/utils";
import { toFormErrorMessage } from "@publira/utils/field-errors";
import { toFormDataInput } from "@publira/utils/form-data";
import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";

import { requestPlatformEmailChange } from "#lib/email-change";
import {
  sendPlatformSmtpTestEmail,
  updatePlatformEmailSettings,
} from "#lib/email-settings";
import type { PlatformSmtpSettings } from "#lib/email-settings-shared";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "#lib/email-settings-shared";
import {
  platformSettingsCacheTag,
  updatePlatformDefaultTimezone,
} from "#lib/platform-settings";

export type PlatformEmailSettingsFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; settings: PlatformSmtpSettings }
  | null;

export type PlatformSmtpTestFormState =
  | { message: string; ok: false }
  | { message: string; ok: true; recipientEmail: string }
  | null;

export type PlatformEmailChangeActionState =
  | { message: string; ok: false }
  | { message: string; ok: true }
  | null;

export type PlatformDefaultTimezoneActionState =
  | { defaultTimezone: string; message: string; ok: true }
  | { message: string; ok: false }
  | null;

/**
 * The Go server validates against the IANA tzdata it embeds
 * (`server/internal/tenanttz`) and stays the authority; this only gives the
 * operator immediate feedback instead of a round trip.
 */
const platformDefaultTimezoneSchema = z.object({
  defaultTimezone: z
    .string({ error: "タイムゾーンを選択してください。" })
    .trim()
    .min(1, "タイムゾーンを選択してください。")
    .refine(isValidTimeZone, {
      error: "有効なタイムゾーンを選択してください。",
    }),
});

interface ParsedSmtpFormData {
  encryption: string;
  fromAddress: string;
  host: string;
  password: string;
  passwordUpdateMode: number;
  port: number;
  recipientEmail: string;
  recipientType: number;
  replyTo: string;
  username: string;
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

const parseSmtpFormData = (formData: FormData): ParsedSmtpFormData => ({
  encryption: String(formData.get("encryption") ?? "")
    .trim()
    .toLowerCase(),
  fromAddress: String(formData.get("from_address") ?? "").trim(),
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
  username: String(formData.get("username") ?? "").trim(),
});

export const updatePlatformEmailSettingsAction = async (
  _prevState: PlatformEmailSettingsFormState,
  formData: FormData
): Promise<PlatformEmailSettingsFormState> => {
  const input = parseSmtpFormData(formData);

  const result = await updatePlatformEmailSettings({
    encryption: input.encryption,
    fromAddress: input.fromAddress,
    host: input.host,
    password: input.password,
    passwordUpdateMode: input.passwordUpdateMode,
    port: input.port,
    replyTo: input.replyTo,
    username: input.username,
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  revalidatePath("/settings/email");
  return {
    message: "メール設定を保存しました。",
    ok: true,
    settings: result.settings,
  };
};

export const updatePlatformDefaultTimezoneAction = async (
  _prevState: PlatformDefaultTimezoneActionState,
  formData: FormData
): Promise<PlatformDefaultTimezoneActionState> => {
  const parsed = platformDefaultTimezoneSchema.safeParse(
    toFormDataInput(formData, {
      defaultTimezone: { kind: "value", name: "default_timezone" },
    })
  );
  if (!parsed.success) {
    // One control, so the field message is the form message.
    return { message: toFormErrorMessage(parsed.error), ok: false };
  }

  const result = await updatePlatformDefaultTimezone(
    parsed.data.defaultTimezone
  );
  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  // The settings screen and the console's timestamps read the setting through a
  // private cache, so without this the operator would keep seeing the previous
  // zone in the same session.
  updateTag(platformSettingsCacheTag);

  return {
    defaultTimezone: result.defaultTimezone,
    message: "既定タイムゾーンを保存しました。",
    ok: true,
  };
};

export const sendPlatformSmtpTestEmailAction = async (
  _prevState: PlatformSmtpTestFormState,
  formData: FormData
): Promise<PlatformSmtpTestFormState> => {
  const input = parseSmtpFormData(formData);

  const result = await sendPlatformSmtpTestEmail({
    encryption: input.encryption,
    fromAddress: input.fromAddress,
    host: input.host,
    password: input.password,
    passwordUpdateMode: input.passwordUpdateMode,
    port: input.port,
    recipientEmail: input.recipientEmail,
    recipientType: input.recipientType,
    replyTo: input.replyTo,
    username: input.username,
  });

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message: `接続テストメールを送信しました（送信先: ${result.recipientEmail}）。`,
    ok: true,
    recipientEmail: result.recipientEmail,
  };
};

export const requestPlatformEmailChangeAction = async (
  _prevState: PlatformEmailChangeActionState,
  formData: FormData
): Promise<PlatformEmailChangeActionState> => {
  const currentEmail = String(formData.get("current_email") ?? "").trim();
  const newEmail = String(formData.get("new_email") ?? "").trim();
  const currentPassword = String(formData.get("current_password") ?? "");

  if (!currentEmail || !newEmail || !currentPassword) {
    return { message: "すべての項目を入力してください。", ok: false };
  }

  const result = await requestPlatformEmailChange(
    currentEmail,
    newEmail,
    currentPassword
  );

  if (!result.ok) {
    return { message: result.message, ok: false };
  }

  return {
    message:
      "現在のメールアドレスと新しいメールアドレスの両方に確認メールを送信しました。両方のリンクを開いて変更を完了してください。",
    ok: true,
  };
};
