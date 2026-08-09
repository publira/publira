import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import type { PlatformSmtpSettings } from "./email-settings-shared";

export {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "./email-settings-shared";
export type { PlatformSmtpSettings } from "./email-settings-shared";

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

/**
 * SMTP failures carry the detail an operator needs to fix the settings ("dial
 * tcp: connection refused", "from_address is required"), so validation and
 * precondition errors pass the server's own text through. Other categories take
 * the shared copy — a raw `[internal]` message is not something to show. Same
 * rule as `apps/web-admin/lib/email-settings.ts`.
 */
const parseErrorMessage = (error: unknown): string => {
  const serverMessage =
    rpcErrorRawMessage(error)?.trim() || genericErrorMessage;
  return rpcErrorMessage(error, genericErrorMessage, {
    "invalid-argument": serverMessage,
    precondition: serverMessage,
  });
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
      rethrowUnclassifiedRpcError(error);
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
    rethrowUnclassifiedRpcError(error);
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
    rethrowUnclassifiedRpcError(error);
    return { message: parseErrorMessage(error), ok: false };
  }
};
