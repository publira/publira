import type { TenantSignUpSettings as RpcTenantSignUpSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
  rpcErrorDisposition,
  rpcErrorHasFieldViolation,
} from "@publira/api-client/errors";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { cacheTag } from "next/cache";

import {
  isUnauthenticatedError,
  rethrowUnauthenticatedRpcError,
} from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import type { CachedRead } from "./cached-read";
import { settleCachedRead } from "./cached-read";
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import { MAX_SIGN_UP_CLOSED_MESSAGE_LENGTH } from "./tenant-sign-up-settings-shared";

/** Whether the tenant takes new readers, and what its site says if not. */
export interface TenantSignUpSettings {
  /**
   * Plain text the storefront shows while sign-up is closed; empty for the
   * storefront's own copy. Kept while sign-up is open.
   */
  closedMessage: string;
  signUpOpen: boolean;
}

export type GetTenantSignUpSettingsResult =
  | { ok: true; settings: TenantSignUpSettings }
  | {
      ok: false;
      message: string;
      /**
       * No settings. A read that failed has no saved state to report, and a
       * card offering to save one would open sign-up for a tenant that closed
       * it, or close it for one that did not.
       */
      requiresSignIn: boolean;
    };

export type UpdateTenantSignUpSettingsResult =
  | { ok: true; settings: TenantSignUpSettings }
  | {
      ok: false;
      message: string;
      /** The server refused the message, worded for the field. */
      closedMessageError?: string;
    };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved values visible in the same session instead of leaving
 * the previous ones in the private cache.
 */
export const tenantSignUpSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:sign-up-settings`;

type RawTenantSignUpSettings = Pick<
  RpcTenantSignUpSettings,
  "closedMessage" | "signUpOpen"
>;

/**
 * `undefined` for a response that carries no settings. That is a read that
 * failed to say anything, and reporting it as "open" would put that in front
 * of an operator as the tenant's own choice.
 */
const toTenantSignUpSettings = (
  settings: RawTenantSignUpSettings | undefined
): TenantSignUpSettings | undefined =>
  settings
    ? { closedMessage: settings.closedMessage, signUpOpen: settings.signUpOpen }
    : undefined;

const getTenantSignUpSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetTenantSignUpSettingsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
    };
  }

  cacheTag(tenantSignUpSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.tenantSettings.getTenantSignUpSettings(
      { tenant: { tenantId: normalizedTenantId } },
      withSessionHeaders(sessionId)
    );

    const settings = toTenantSignUpSettings(response.settings);

    if (!settings) {
      dropFailedCacheEntry();

      return {
        message: t("admin.settings.sign_up.load_failed"),
        ok: false,
        requiresSignIn: false,
      };
    }

    return { ok: true, settings };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: rpcErrorMessage(error, t("admin.settings.sign_up.load_failed"), {
        locale,
      }),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

export const getTenantSignUpSettings = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantSignUpSettingsResult> =>
  settleCachedRead(
    await getTenantSignUpSettingsForSession(
      tenantId,
      locale,
      await getAccessToken()
    )
  );

export const updateTenantSignUpSettings = async (
  input: { tenantId: string } & TenantSignUpSettings,
  locale: Locale
): Promise<UpdateTenantSignUpSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantSignUpSettings(
      {
        settings: {
          closedMessage: input.closedMessage,
          signUpOpen: input.signUpOpen,
        },
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    const settings = toTenantSignUpSettings(response.settings);

    if (!settings) {
      return { message: t("admin.settings.sign_up.save_failed"), ok: false };
    }

    return { ok: true, settings };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    if (rpcErrorHasFieldViolation(error, "settings.closed_message")) {
      const closedMessageError = t(
        "admin.settings.sign_up.validation.message_too_long",
        { max: MAX_SIGN_UP_CLOSED_MESSAGE_LENGTH }
      );

      return { closedMessageError, message: closedMessageError, ok: false };
    }

    return {
      message: rpcErrorMessage(error, t("admin.settings.sign_up.save_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};
