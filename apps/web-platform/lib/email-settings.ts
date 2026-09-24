import {
  rpcErrorMessage,
  smtpTestFailureErrorMessage,
} from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorRawMessage,
} from "@publira/api-client/errors";
import type { PlatformEmailSettings } from "@publira/api-client/platform/types";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  apiClient,
  buildSessionHeaders,
  resolveAccessToken,
} from "./api-client";
import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./auth-shared";
import type { PlatformSmtpSettings } from "./email-settings-shared";
import { getMessagesFor } from "./messages";

export {
  SECRET_UPDATE_MODE_REPLACE,
  SECRET_UPDATE_MODE_UNCHANGED,
  TEST_EMAIL_RECIPIENT_TYPE_CUSTOM,
  TEST_EMAIL_RECIPIENT_TYPE_SELF,
} from "./email-settings-shared";
export type { PlatformSmtpSettings } from "./email-settings-shared";

export interface UpdatePlatformSmtpSettingsInput {
  encryption: string;
  /**
   * The revision the form was rendered at, so a save based on values another
   * session has since replaced is refused instead of rolling them back.
   */
  expectedRevision: bigint;
  fromAddress: string;
  host: string;
  locale: Locale;
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
  locale: Locale;
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
  | {
      message: string;
      ok: false;
      /**
       * The API rejected the session while reading the settings — the page
       * raises the login redirect. The update path throws instead, so only
       * {@link getPlatformEmailSettings} ever sets it.
       */
      requiresSignIn?: boolean;
    };

export type PlatformSmtpTestResult =
  | { ok: true; recipientEmail: string }
  | { message: string; ok: false };

/**
 * SMTP failures carry the detail an operator needs to fix the settings
 * ("from_address is required"), so validation errors pass the server's own text
 * through. A refused precondition is the save's revision check: the settings
 * moved on since the form was rendered, and only a reload shows what they are
 * now. Other categories take the shared copy — a raw `[internal]` message is
 * not something to show.
 */
const parseErrorMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  const genericErrorMessage = t("platform.common.generic_failed");
  return rpcErrorMessage(error, genericErrorMessage, {
    locale,
    overrides: {
      "invalid-argument":
        rpcErrorRawMessage(error)?.trim() || genericErrorMessage,
      precondition: t("platform.settings.save_conflict"),
    },
  });
};

const parseSmtpTestErrorMessage = async (
  error: unknown,
  locale: Locale
): Promise<string> => {
  const t = await getMessagesFor(locale);
  const fallback = t("platform.common.generic_failed");

  return (
    smtpTestFailureErrorMessage(error, locale) ??
    rpcErrorMessage(error, fallback, {
      locale,
      overrides: { precondition: fallback },
    })
  );
};

/**
 * The generated `PlatformEmailSettings` fields {@link toPlatformSmtpSettings}
 * reads. Naming them against the message type is what makes a proto rename fail
 * here — a restated structural type keeps compiling, and the SMTP form then
 * opens with an empty host and the default port as if nothing had been saved.
 */
type RawPlatformEmailSettings = Pick<
  PlatformEmailSettings,
  | "encryption"
  | "fromAddress"
  | "hasPassword"
  | "host"
  | "port"
  | "replyTo"
  | "revision"
  | "username"
>;

const toPlatformSmtpSettings = (
  settings?: RawPlatformEmailSettings
): PlatformSmtpSettings => ({
  encryption: settings?.encryption ?? "",
  fromAddress: settings?.fromAddress ?? "",
  hasPassword: Boolean(settings?.hasPassword),
  host: settings?.host ?? "",
  port: settings?.port ?? 587,
  replyTo: settings?.replyTo ?? "",
  revision: String(settings?.revision ?? 0),
  username: settings?.username ?? "",
});

/** The tag the SMTP settings read is filed under, and their save clears. */
export const platformEmailSettingsCacheTag = "platform:email-settings";

export const getPlatformEmailSettings = async (
  locale: Locale
): Promise<PlatformSmtpSettingsResult> => {
  "use cache: private";
  cacheTag(platformEmailSettingsCacheTag);

  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: true,
    };
  }

  try {
    const response = await apiClient.emailSettings.getPlatformEmailSettings(
      {},
      buildSessionHeaders(sessionId)
    );
    return { ok: true, settings: toPlatformSmtpSettings(response.settings) };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it after
    // the API recovers, and a cached `requiresSignIn` would bounce the operator
    // back to /login even once they have signed in again.
    dropFailedCacheEntry();
    return {
      message: await parseErrorMessage(error, locale),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

export const updatePlatformEmailSettings = async (
  input: UpdatePlatformSmtpSettingsInput
): Promise<PlatformSmtpSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.emailSettings.updatePlatformEmailSettings(
      {
        encryption: input.encryption,
        expectedRevision: input.expectedRevision,
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseErrorMessage(error, input.locale),
      ok: false,
    };
  }
};

export const sendPlatformSmtpTestEmail = async (
  input: SendPlatformSmtpTestInput
): Promise<PlatformSmtpTestResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(input.locale),
    resolveAccessToken(),
  ]);
  if (!sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
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
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: await parseSmtpTestErrorMessage(error, input.locale),
      ok: false,
    };
  }
};
