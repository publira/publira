import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import type { PlatformSmtpSettings } from "./email-settings-shared";
import {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "./email-settings-shared";

export {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
};
export type { PlatformSmtpSettings };

export interface UpdatePlatformSmtpSettingsInput {
  encryption: string;
  fromAddress: string;
  host: string;
  password: string;
  passwordUpdateMode: number;
  port: number;
  replyTo: string;
  username: string;
}

export interface SendPlatformSmtpTestInput {
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

export type PlatformSmtpSettingsResult =
  | { ok: true; settings: PlatformSmtpSettings }
  | { message: string; ok: false };

export type PlatformSmtpTestResult =
  | { ok: true; recipientEmail: string }
  | { message: string; ok: false };

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

const toPlatformSmtpSettings = (settings?: {
  encryption?: string;
  fromAddress?: string;
  hasPassword?: boolean;
  host?: string;
  port?: number;
  replyTo?: string;
  username?: string;
}): PlatformSmtpSettings => ({
  encryption: settings?.encryption ?? "",
  fromAddress: settings?.fromAddress ?? "",
  hasPassword: Boolean(settings?.hasPassword),
  host: settings?.host ?? "",
  port: settings?.port ?? 587,
  replyTo: settings?.replyTo ?? "",
  username: settings?.username ?? "",
});

export const getPlatformEmailSettings =
  async (): Promise<PlatformSmtpSettingsResult> => {
    "use cache: private";

    const sessionId = await resolveAccessToken();
    if (!sessionId) {
      return { message: sessionErrorMessage, ok: false };
    }

    try {
      const response = await apiClient.emailSettings.getPlatformEmailSettings(
        {},
        buildSessionHeaders(sessionId)
      );
      return { ok: true, settings: toPlatformSmtpSettings(response.settings) };
    } catch (error) {
      return { message: parseErrorMessage(error), ok: false };
    }
  };

export const updatePlatformEmailSettings = async (
  input: UpdatePlatformSmtpSettingsInput
): Promise<PlatformSmtpSettingsResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.emailSettings.updatePlatformEmailSettings(
      {
        encryption: input.encryption,
        fromAddress: input.fromAddress,
        host: input.host,
        password: input.password,
        passwordUpdateMode: input.passwordUpdateMode,
        port: input.port,
        replyTo: input.replyTo,
        username: input.username,
      } as never,
      buildSessionHeaders(sessionId)
    );

    return { ok: true, settings: toPlatformSmtpSettings(response.settings) };
  } catch (error) {
    return { message: parseErrorMessage(error), ok: false };
  }
};

export const sendPlatformSmtpTestEmail = async (
  input: SendPlatformSmtpTestInput
): Promise<PlatformSmtpTestResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    return { message: sessionErrorMessage, ok: false };
  }

  try {
    const response = await apiClient.emailSettings.sendPlatformSmtpTestEmail(
      {
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
      } as never,
      buildSessionHeaders(sessionId)
    );

    return { ok: true, recipientEmail: response.recipientEmail };
  } catch (error) {
    return { message: parseErrorMessage(error), ok: false };
  }
};
