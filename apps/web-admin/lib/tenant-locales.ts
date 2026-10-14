import { rpcErrorMessage } from "@publira/api-client/error-messages";
import { rethrowUnclassifiedRpcError } from "@publira/api-client/errors";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";

import { rethrowUnauthenticatedRpcError } from "./admin-auth-shared";
import { apiClient, withSessionHeaders } from "./api";
import { getMessagesFor } from "./messages";
import { getTenantPublicInfo, readSupportedLocales } from "./public-api";
import { getAccessToken } from "./session";

/** The languages the tenant's site offers, in the registry's order, and the one it starts in. */
export interface TenantLocales {
  defaultLocale: Locale;
  supportedLocales: readonly Locale[];
}

export type GetTenantLocalesResult =
  | ({ ok: true } & TenantLocales)
  /**
   * No locales. A read that failed has no saved languages to report, and the
   * settings screen would otherwise offer to save a set nobody chose over the
   * stored one.
   */
  | { ok: false; message: string };

export type UpdateTenantLocalesResult =
  | ({ ok: true } & TenantLocales)
  | { ok: false; message: string };

/**
 * A default and a set that agree, or `undefined`. The API never answers a set
 * without its default, so one that arrives that way names a code this build
 * serves no catalog for, and the pair is no more usable than a missing one.
 */
const resolveTenantLocales = (
  defaultLocale: Locale | null | undefined,
  supportedLocales: readonly Locale[] | null | undefined
): TenantLocales | undefined =>
  defaultLocale && supportedLocales?.includes(defaultLocale)
    ? { defaultLocale, supportedLocales }
    : undefined;

/**
 * The saved languages, or `null` when they cannot be read.
 *
 * Read from the public `GetTenant`, which answers the same stored values as the
 * admin API's `GetTenantDefaultLocale` to everyone, so the entry is shared by
 * every operator of the tenant and filed under `tenant:<id>:site`.
 */
export const findTenantLocales = async (
  tenantId: string
): Promise<TenantLocales | null> => {
  const info = await getTenantPublicInfo(tenantId);
  return (
    resolveTenantLocales(info?.defaultLocale, info?.supportedLocales) ?? null
  );
};

/**
 * The saved languages, for the settings screen that edits them and the page
 * editor that starts a translation in the default one.
 */
export const getTenantLocales = async (
  tenantId: string,
  locale: Locale
): Promise<GetTenantLocalesResult> => {
  const locales = await findTenantLocales(tenantId);
  if (locales) {
    return { ...locales, ok: true };
  }

  const t = await getMessagesFor(locale);
  return {
    message: t("admin.settings.locales.load_failed"),
    ok: false,
  };
};

/**
 * Saves the default and the set in the one request the API takes them in, so
 * the two can never be stored apart. The server refuses a set without the
 * default, deduplicates it, and stores it in the registry's order.
 */
export const updateTenantLocales = async (
  input: {
    tenantId: string;
    defaultLocale: Locale;
    supportedLocales: readonly Locale[];
  },
  locale: Locale
): Promise<UpdateTenantLocalesResult> => {
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
        supportedLocales: [...input.supportedLocales],
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );
    const saved = resolveTenantLocales(
      parseLocale(response.defaultLocale.trim()),
      readSupportedLocales(response.supportedLocales)
    );
    if (!saved) {
      return {
        message: t("admin.settings.locales.save_failed"),
        ok: false,
      };
    }

    return { ...saved, ok: true };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);
    return {
      message: rpcErrorMessage(error, t("admin.settings.locales.save_failed"), {
        locale,
      }),
      ok: false,
    };
  }
};
