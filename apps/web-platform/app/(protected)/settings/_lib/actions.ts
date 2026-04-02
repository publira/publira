"use server";

import { revalidatePath } from "next/cache";

import { requestPlatformEmailChange } from "../../../../lib/email-change";
import {
  sendPlatformSmtpTestEmail,
  updatePlatformEmailSettings,
} from "../../../../lib/email-settings";
import type { PlatformSmtpSettings } from "../../../../lib/email-settings-shared";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "../../../../lib/email-settings-shared";

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
