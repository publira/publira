import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import type { PlatformWebPushSettings as RawPlatformWebPushSettingsMessage } from "@publira/api-client/platform/types";
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
import { getMessagesFor } from "./messages";

/** What the console shows of the Web Push identity; never the private key. */
export interface PlatformWebPushSettings {
  /** Whether a subject is saved, which is what turns Web Push on. */
  configured: boolean;
  subject: string;
  /** Decimal int64 the row was read at. */
  revision: string;
}

export type GetPlatformWebPushSettingsResult =
  | { ok: true; settings: PlatformWebPushSettings }
  | { message: string; ok: false; requiresSignIn: boolean };

export type UpdatePlatformWebPushSubjectResult =
  | { ok: true; settings: PlatformWebPushSettings }
  | { message: string; ok: false };

/** The tag the Web Push settings read is filed under, and a save clears. */
export const platformWebPushSettingsCacheTag = "platform:webpush-settings";

export const toPlatformWebPushSettings = (
  settings?: Pick<
    RawPlatformWebPushSettingsMessage,
    "hasSubject" | "revision" | "subject"
  >
): PlatformWebPushSettings => ({
  configured: settings?.hasSubject ?? false,
  revision: String(settings?.revision ?? 0),
  subject: settings?.subject ?? "",
});

export const getPlatformWebPushSettings = async (
  locale: Locale
): Promise<GetPlatformWebPushSettingsResult> => {
  "use cache: private";
  cacheTag(platformWebPushSettingsCacheTag);

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
    const response = await apiClient.webPushSettings.getPlatformWebPushSettings(
      {},
      buildSessionHeaders(sessionId)
    );
    return {
      ok: true,
      settings: toPlatformWebPushSettings(response.settings),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    // A failed read must not be cached: the client router would replay it
    // after the API recovers.
    dropFailedCacheEntry();
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.webpush.load_failed"), {
        locale,
        overrides: {
          // The first read generates the key pair, which needs a key to seal
          // the private half with.
          precondition: t("platform.webpush.encryption_unavailable"),
        },
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * Save the subject. `expectedRevision` is the revision the screen was rendered
 * at, so a save based on a subject another operator has since replaced is
 * refused instead of rolling their change back.
 */
export const updatePlatformWebPushSubject = async (
  subject: string,
  expectedRevision: bigint,
  locale: Locale
): Promise<UpdatePlatformWebPushSubjectResult> => {
  const sessionId = await resolveAccessToken();
  if (!sessionId) {
    const t = await getMessagesFor(locale);
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.webPushSettings.updatePlatformWebPushSubject(
        { expectedRevision, subject },
        buildSessionHeaders(sessionId)
      );
    return {
      ok: true,
      settings: toPlatformWebPushSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    const t = await getMessagesFor(locale);
    return {
      message: rpcErrorMessage(error, t("platform.webpush.save_failed"), {
        locale,
        overrides: {
          "invalid-argument": t("platform.webpush.form.subject_invalid"),
          precondition: t("platform.webpush.save_conflict"),
        },
      }),
      ok: false,
    };
  }
};
