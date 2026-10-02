import {
  rpcErrorMessage,
  smtpTestFailureErrorMessage,
} from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorHasFieldViolation,
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
  withServiceHeaders,
} from "./api-client";
import { verifyPlatformSession } from "./auth-session";
import { rethrowUnauthenticatedRpcError } from "./auth-shared";
import type { PlatformSmtpSettings } from "./email-settings-shared";
import { getPlatformLocale } from "./locale";
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
      /**
       * What the save refused about one field, in the form's words. Only
       * {@link updatePlatformEmailSettings} sets it.
       */
      fieldErrors?: { username?: string };
      message: string;
      ok: false;
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

const getPlatformEmailSettingsForLocale = async (
  locale: Locale
): Promise<PlatformSmtpSettingsResult> => {
  "use cache";
  cacheTag(platformEmailSettingsCacheTag);

  try {
    const response = await apiClient.emailSettings.getPlatformEmailSettings(
      {},
      withServiceHeaders()
    );
    return { ok: true, settings: toPlatformSmtpSettings(response.settings) };
  } catch (error) {
    // A `"use cache"` scope cannot rethrow: the fill would fail the whole
    // request. The entry is dropped instead, so the settings come back as
    // soon as the API does.
    dropFailedCacheEntry();
    return {
      message: await parseErrorMessage(error, locale),
      ok: false,
    };
  }
};

/**
 * The SMTP settings, for their screen and the setup checklist. The password
 * itself never leaves the API: the answer says only whether one is set.
 *
 * Read with the service credential: the settings are the same for every
 * operator, so one entry serves all of them.
 */
export const getPlatformEmailSettings =
  async (): Promise<PlatformSmtpSettingsResult> => {
    await verifyPlatformSession();
    return getPlatformEmailSettingsForLocale(await getPlatformLocale());
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
    // The one refusal naming the username is a password, entered or kept from
    // the stored settings, with no username to authenticate it.
    if (rpcErrorHasFieldViolation(error, "username")) {
      return {
        fieldErrors: {
          username: t("platform.settings.username_required_with_password"),
        },
        message: t("errors.validation"),
        ok: false,
      };
    }
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
