import type { TenantEmailSettings } from "@publira/api-client/admin/types";
import {
  rpcErrorMessage,
  smtpTestFailureErrorMessage,
} from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import { getMessage } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { sharedCatalog } from "@publira/i18n/catalog";
import type { SharedMessages } from "@publira/i18n/catalog";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { TenantSmtpSettings } from "./email-settings-shared";
import { getAccessToken } from "./session";

export type { TenantSmtpSettings } from "./email-settings-shared";

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
  | {
      ok: false;
      message: string;
      /**
       * The API rejected the session while reading the settings — the page
       * raises the login redirect. The update path throws instead, so only
       * {@link getTenantEmailSettings} ever sets it.
       */
      requiresSignIn?: boolean;
    };

export type TenantSmtpTestResult =
  | { ok: true; recipientEmail: string }
  | { ok: false; message: string };

const genericErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "admin.settings.email.failed");
const sessionErrorMessage = (messages: SharedMessages): string =>
  getMessage(messages, "errors.rpc.unauthenticated");

/**
 * SMTP failures carry the detail an operator needs to fix the settings ("dial
 * tcp: connection refused", "from_address is required"), so validation and
 * precondition errors pass the server's own text through. Other categories take
 * the shared copy — a raw `[internal]` message is not something to show.
 */
const parseErrorMessage = (error: unknown, locale: Locale): string => {
  const fallback = genericErrorMessage(sharedCatalog(locale));
  const serverMessage = rpcErrorRawMessage(error)?.trim() || fallback;
  return rpcErrorMessage(error, fallback, {
    locale,
    overrides: {
      "invalid-argument": serverMessage,
      precondition: serverMessage,
    },
  });
};

const parseSmtpTestErrorMessage = (error: unknown, locale: Locale): string => {
  const fallback = genericErrorMessage(sharedCatalog(locale));

  return (
    smtpTestFailureErrorMessage(error, locale) ??
    rpcErrorMessage(error, fallback, {
      locale,
      overrides: { precondition: fallback },
    })
  );
};

/**
 * The generated `TenantEmailSettings` fields {@link toTenantSmtpSettings}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, and the mapper silently
 * substitutes an empty string for the field it can no longer find.
 */
type RawTenantEmailSettings = Pick<
  TenantEmailSettings,
  | "encryption"
  | "fromAddress"
  | "fromName"
  | "hasPassword"
  | "host"
  | "port"
  | "replyTo"
  | "smtpOverrideEnabled"
  | "username"
>;

const toTenantSmtpSettings = (
  settings?: RawTenantEmailSettings
): TenantSmtpSettings => ({
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
  tenantId: string,
  locale: Locale
): Promise<TenantSmtpSettingsResult> => {
  "use cache: private";

  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return {
      message: sessionErrorMessage(messages),
      ok: false,
      requiresSignIn: !sessionId,
    };
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
    rethrowUnclassifiedRpcError(error);
    return {
      message: parseErrorMessage(error, locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updateTenantEmailSettings = async (
  input: UpdateTenantSmtpSettingsInput,
  locale: Locale
): Promise<TenantSmtpSettingsResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return { message: parseErrorMessage(error, locale), ok: false };
  }
};

export const sendTenantSmtpTestEmail = async (
  input: SendTenantSmtpTestInput,
  locale: Locale
): Promise<TenantSmtpTestResult> => {
  const messages = sharedCatalog(locale);
  const sessionId = await getAccessToken();
  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: sessionErrorMessage(messages), ok: false };
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return { message: parseSmtpTestErrorMessage(error, locale), ok: false };
  }
};
