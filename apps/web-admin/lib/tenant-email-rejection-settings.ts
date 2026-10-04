import type { TenantEmailRejectionSettings as RpcTenantEmailRejectionSettings } from "@publira/api-client/admin/types";
import { rpcErrorMessage } from "@publira/api-client/error-messages";
import {
  rethrowUnclassifiedRpcError,
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
import { getMessagesFor } from "./messages";
import { getAccessToken } from "./session";
import { MAX_EMAIL_REJECTION_ENTRIES } from "./tenant-email-rejection-settings-shared";

/** What the tenant refuses at reader sign-up and at a reader's email change. */
export interface TenantEmailRejectionSettings {
  /** Whether the disposable-domain list the platform policy names applies. */
  rejectDisposableDomains: boolean;
  /** Addresses and domains, normalized by the server and in lexical order. */
  entries: string[];
}

export type TenantEmailRejectionSettingsResult =
  | {
      ok: true;
      settings: TenantEmailRejectionSettings;
      /**
       * Whether the platform policy names a disposable-domain list. While it
       * does not, the switch is stored and refuses nothing.
       */
      disposableDomainListAvailable: boolean;
    }
  | {
      ok: false;
      message: string;
      /** The refusal of the list itself, worded for the field. */
      entriesError?: string;
      /** Set by the read only; the update path throws instead. */
      requiresSignIn?: boolean;
    };

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved list visible in the same session instead of leaving
 * the previous one in the private cache.
 */
export const tenantEmailRejectionSettingsCacheTag = (
  tenantId: string
): string => `tenant:${tenantId.trim()}:email-rejection-settings`;

type RawTenantEmailRejectionSettings = Pick<
  RpcTenantEmailRejectionSettings,
  "entries" | "rejectDisposableDomains"
>;

const toTenantEmailRejectionSettings = (
  settings?: RawTenantEmailRejectionSettings
): TenantEmailRejectionSettings => ({
  entries: [...(settings?.entries ?? [])],
  rejectDisposableDomains: Boolean(settings?.rejectDisposableDomains),
});

const getTenantEmailRejectionSettingsForSession = async (
  tenantId: string,
  locale: Locale,
  sessionId: string
): Promise<TenantEmailRejectionSettingsResult> => {
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

  cacheTag(tenantEmailRejectionSettingsCacheTag(normalizedTenantId));

  try {
    const response =
      await apiClient.tenantSettings.getTenantEmailRejectionSettings(
        { tenant: { tenantId: normalizedTenantId } },
        withSessionHeaders(sessionId)
      );
    return {
      disposableDomainListAvailable: response.disposableDomainListAvailable,
      ok: true,
      settings: toTenantEmailRejectionSettings(response.settings),
    };
  } catch (error) {
    rethrowUnclassifiedRpcError(error);
    dropFailedCacheEntry();
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.email_rejection.load_failed"),
        { locale }
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
    };
  }
};

/**
 * The API answers this to a tenant administrator only, so the settings screen
 * calls it for one and renders the card read-only for anyone else without
 * asking: a refusal there says nothing the read-only notice does not.
 */
export const getTenantEmailRejectionSettings = async (
  tenantId: string,
  locale: Locale
): Promise<TenantEmailRejectionSettingsResult> =>
  getTenantEmailRejectionSettingsForSession(
    tenantId,
    locale,
    await getAccessToken()
  );

/** Replaces the whole setting: the list sent is the list stored. */
export const updateTenantEmailRejectionSettings = async (
  input: { tenantId: string } & TenantEmailRejectionSettings,
  locale: Locale
): Promise<TenantEmailRejectionSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response =
      await apiClient.tenantSettings.updateTenantEmailRejectionSettings(
        {
          settings: {
            entries: input.entries,
            rejectDisposableDomains: input.rejectDisposableDomains,
          },
          tenant: { tenantId: normalizedTenantId },
        },
        withSessionHeaders(sessionId)
      );
    return {
      disposableDomainListAvailable: response.disposableDomainListAvailable,
      ok: true,
      settings: toTenantEmailRejectionSettings(response.settings),
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    // The Action checks each line by the server's rule first, so this is a
    // line the two rules read differently; the server's answer is the one
    // that stands, and it does not say which line it refused.
    if (rpcErrorHasFieldViolation(error, "settings.entries")) {
      const entriesError = t(
        "admin.settings.email_rejection.validation.entries_refused",
        { max: MAX_EMAIL_REJECTION_ENTRIES }
      );
      return { entriesError, message: entriesError, ok: false };
    }
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.email_rejection.save_failed"),
        { locale }
      ),
      ok: false,
    };
  }
};
