import { apiClient, withSessionHeaders } from "./api";
import type { TenantSmtpSettings } from "./email-settings-shared";
import { getAccessToken } from "./session";

export type { TenantSmtpSettings };

export interface UpdateTenantSmtpSettingsInput {
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
}

export interface SendTenantSmtpTestInput {
  tenantId: string;
  recipientType: number;
  recipientEmail: string;
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
}

export type TenantSmtpSettingsResult =
  | { ok: true; settings: TenantSmtpSettings }
  | { ok: false; message: string };

export type TenantSmtpTestResult =
  | { ok: true; recipientEmail: string }
  | { ok: false; message: string };

const genericErrorMessage =
  "処理に失敗しました。時間をおいて再試行してください。";
const sessionErrorMessage = "セッションが無効です。再ログインしてください。";

const parseErrorMessage = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return genericErrorMessage;
  }

  const message = error.message.trim();
  if (!message) {
    return genericErrorMessage;
  }

  const prefixes = [
    "invalid_argument:",
    "failed_precondition:",
    "permission_denied:",
  ] as const;

  const lower = message.toLowerCase();
  for (const prefix of prefixes) {
    if (lower.startsWith(prefix)) {
      return message.slice(prefix.length).trim() || genericErrorMessage;
    }
  }

  return message;
};

const toTenantSmtpSettings = (settings?: {
  smtpOverrideEnabled?: boolean;
  host?: string;
  port?: number;
  username?: string;
  encryption?: string;
  fromName?: string;
  fromAddress?: string;
  replyTo?: string;
  hasPassword?: boolean;
}): TenantSmtpSettings => ({
  encryption: settings?.encryption ?? "starttls",
  fromAddress: settings?.fromAddress ?? "",
  fromName: settings?.fromName ?? "",
  hasPassword: Boolean(settings?.hasPassword),
  host: settings?.host ?? "",
  port: settings?.port ?? 587,
  replyTo: settings?.replyTo ?? "",
  smtpOverrideEnabled: Boolean(settings?.smtpOverrideEnabled),
  username: settings?.username ?? "",
});

export const getTenantEmailSettings = async (
  tenantId: string
): Promise<TenantSmtpSettingsResult> => {
  "use cache: private";

  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.emailSettings.getTenantEmailSettings(
      {
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return { ok: true, settings: toTenantSmtpSettings(response.settings) };
  } catch (error) {
    return { message: parseErrorMessage(error), ok: false };
  }
};

export const updateTenantEmailSettings = async (
  input: UpdateTenantSmtpSettingsInput
): Promise<TenantSmtpSettingsResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.emailSettings.updateTenantEmailSettings(
      {
        encryption: input.encryption,
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        host: input.host,
        password: input.password,
        passwordUpdateMode: input.passwordUpdateMode,
        port: input.port,
        replyTo: input.replyTo,
        smtpOverrideEnabled: input.smtpOverrideEnabled,
        tenant: { tenantId: normalizedTenantId },
        username: input.username,
      } as never,
      withSessionHeaders(sessionId)
    );

    return { ok: true, settings: toTenantSmtpSettings(response.settings) };
  } catch (error) {
    return { message: parseErrorMessage(error), ok: false };
  }
};

export const sendTenantSmtpTestEmail = async (
  input: SendTenantSmtpTestInput
): Promise<TenantSmtpTestResult> => {
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.emailSettings.sendTenantSmtpTestEmail(
      {
        encryption: input.encryption,
        fromAddress: input.fromAddress,
        fromName: input.fromName,
        host: input.host,
        password: input.password,
        passwordUpdateMode: input.passwordUpdateMode,
        port: input.port,
        recipientEmail: input.recipientEmail,
        recipientType: input.recipientType,
        replyTo: input.replyTo,
        smtpOverrideEnabled: input.smtpOverrideEnabled,
        tenant: { tenantId: normalizedTenantId },
        username: input.username,
      } as never,
      withSessionHeaders(sessionId)
    );

    return { ok: true, recipientEmail: response.recipientEmail };
  } catch (error) {
    return { message: parseErrorMessage(error), ok: false };
  }
};
