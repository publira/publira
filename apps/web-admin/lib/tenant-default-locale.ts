import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { findTenantDisplayLocale } from "./public-api";
import { getAccessToken } from "./session";

export type GetTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  /**
   * No `defaultLocale`. A read that failed has no saved language to report,
   * and the settings screen would otherwise offer to save a value nobody chose
   * over the stored one.
   */
  | { ok: false; message: string };

export type UpdateTenantDefaultLocaleResult =
  | { ok: true; defaultLocale: Locale }
  | { ok: false; message: string };

const resolveDefaultLocale = (value: string | undefined): Locale | undefined =>
  parseLocale(value?.trim());

/**
 * The saved default language, for the settings screen that edits it and the
 * page editor that starts a translation in it.
 *
 * Read from the public `GetTenant`, which answers the same stored value as the
 * admin API's `GetTenantDefaultLocale` to everyone, so the entry is shared by
 * every operator of the tenant and filed under `tenant:<id>:site`.
 */
export const getTenantDefaultLocale = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantDefaultLocaleResult> => {
  const defaultLocale = await findTenantDisplayLocale(tenantId);
  if (defaultLocale) {
    return { defaultLocale, ok: true };
  }

  const t = await getMessagesFor(locale);
  return {
    message: t("admin.settings.default_locale.load_failed"),
    ok: false,
  };
};

export const updateTenantDefaultLocale = async (
  input: {
    tenantId: string;
    defaultLocale: Locale;
  },
  locale: Locale
): Promise<UpdateTenantDefaultLocaleResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);
  const normalizedTenantId = input.tenantId.trim();
  if (!normalizedTenantId || !sessionId) {
    return { message: t("errors.rpc.unauthenticated"), ok: false };
  }

  try {
    const response = await apiClient.tenantSettings.updateTenantDefaultLocale(
      {
        defaultLocale: input.defaultLocale,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    const saved = resolveDefaultLocale(response.defaultLocale);
    if (saved === undefined) {
      return {
        message: t("admin.settings.default_locale.save_failed"),
        ok: false,
      };
    }

    return { defaultLocale: saved, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(
        error,
        t("admin.settings.default_locale.save_failed"),
        {
          locale,
        }
      ),
      ok: false,
    };
  }
};
