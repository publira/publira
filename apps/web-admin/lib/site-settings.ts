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
import type { TenantLocales } from "./tenant-locales";

export interface TenantSiteSettings {
  copyrightText: string;
  siteDescription: string;
  siteTagline: string;
}

export type GetTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | {
      ok: false;
      message: string;
      settings: TenantSiteSettings;
      /** The API rejected the session — the page raises the login redirect. */
      requiresSignIn: boolean;
    };

export type UpdateTenantSiteSettingsResult =
  | { ok: true; settings: TenantSiteSettings }
  | { ok: false; message: string };

const defaultSettings: TenantSiteSettings = {
  copyrightText: "",
  siteDescription: "",
  siteTagline: "",
};

/**
 * Tag the settings screen's cached read carries, so `updateTag` in the Server
 * Action makes the saved copy visible in the same session instead of leaving
 * the previous text in the private cache. Distinct from `tenant:<id>:site`,
 * which carries the public read of the tenant's name, theme, and default
 * locale — none of which this screen writes.
 */
export const tenantSiteSettingsCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:site-settings`;

const mapErrorToMessage = (
  error: unknown,
  fallbackMessage: string,
  locale: Locale
): string => rpcErrorMessage(error, fallbackMessage, { locale });

const getTenantSiteSettingsForSession = async (
  tenantId: string,
  translationLocale: Locale | undefined,
  locale: Locale,
  sessionId: string
): Promise<CachedRead<GetTenantSiteSettingsResult>> => {
  "use cache: private";

  const t = await getMessagesFor(locale);
  const normalizedTenantId = tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    dropFailedCacheEntry();

    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
      requiresSignIn: !sessionId,
      settings: defaultSettings,
    };
  }

  cacheTag(tenantSiteSettingsCacheTag(normalizedTenantId));

  try {
    const response = await apiClient.auth.getTenantConfig(
      {
        locale: translationLocale ?? "",
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    dropFailedCacheEntry();

    return {
      message: await mapErrorToMessage(
        error,
        t("admin.settings.site.load_failed"),
        locale
      ),
      ok: false,
      requiresSignIn: isUnauthenticatedError(error),
      settings: defaultSettings,
      unexpected: rpcErrorDisposition(error) === "unexpected",
    };
  }
};

/**
 * One language's site copy, read through the admin API with the operator's
 * session. Without a language it is the default language's.
 *
 * Not through the public `GetTenant`, although it answers the same three
 * fields: that RPC falls back to another language's copy where a language has
 * none, which is what a reader should see, and a tab opened on that answer
 * would save the other language's copy as its own. `GetTenantConfig` answers
 * exactly the language's copy, empty where none was written.
 */
export const getTenantSiteSettings = async (
  tenantId: string,
  translationLocale: Locale | undefined,
  locale: Locale
): Promise<GetTenantSiteSettingsResult> =>
  settleCachedRead(
    await getTenantSiteSettingsForSession(
      tenantId,
      translationLocale,
      locale,
      await getAccessToken()
    )
  );

/**
 * The **Public site display** card: a tab per language the site offers, and
 * the copy of the one it edits.
 */
export interface TenantSiteSettingsTabs {
  /**
   * The languages that have a tab, in the registry's order. None when the
   * site's languages cannot be read: a tab for a language the site does not
   * offer would only save into a refusal, so the card then edits the default
   * language's copy without tabs.
   */
  locales: readonly Locale[];
  /** The tab the card opens on, undefined only when it has no tabs. */
  shownLocale: Locale | undefined;
  settings: TenantSiteSettings;
  /** The tabs whose language has copy written in it. */
  translatedLocales: readonly Locale[];
}

export type GetTenantSiteSettingsTabsResult =
  | ({ ok: true } & TenantSiteSettingsTabs)
  | Extract<GetTenantSiteSettingsResult, { ok: false }>;

const hasCopy = (settings: TenantSiteSettings): boolean =>
  [settings.copyrightText, settings.siteDescription, settings.siteTagline].some(
    (field) => field.trim() !== ""
  );

/**
 * The card's tabs, opened on the language the URL names when the site offers
 * it and on the default language otherwise. Every tab's copy is read, since
 * the API has no other way to say which languages have some, and one failed
 * read fails the card as a single failed read did before it had tabs.
 */
export const getTenantSiteSettingsTabs = async ({
  locale,
  requestedLocale,
  tenantId,
  tenantLocales,
}: {
  locale: Locale;
  requestedLocale: Locale | undefined;
  tenantId: string;
  tenantLocales: TenantLocales | null;
}): Promise<GetTenantSiteSettingsTabsResult> => {
  if (!tenantLocales) {
    const result = await getTenantSiteSettings(tenantId, undefined, locale);

    return result.ok
      ? {
          locales: [],
          ok: true,
          settings: result.settings,
          shownLocale: undefined,
          translatedLocales: [],
        }
      : result;
  }

  const { defaultLocale, supportedLocales: locales } = tenantLocales;

  const results = await Promise.all(
    locales.map((code) => getTenantSiteSettings(tenantId, code, locale))
  );

  const copies = new Map<Locale, TenantSiteSettings>();

  for (const [index, result] of results.entries()) {
    if (!result.ok) {
      return result;
    }

    copies.set(locales[index], result.settings);
  }

  const shownLocale =
    requestedLocale && locales.includes(requestedLocale)
      ? requestedLocale
      : defaultLocale;

  return {
    locales,
    ok: true,
    settings: copies.get(shownLocale) ?? defaultSettings,
    shownLocale,
    translatedLocales: locales.filter((code) => {
      const copy = copies.get(code);

      return copy !== undefined && hasCopy(copy);
    }),
  };
};

export const updateTenantSiteSettings = async (
  input: {
    tenantId: string;
    copyrightText: string;
    siteDescription: string;
    siteTagline: string;
    /** The language the copy is written in; absent, the default language. */
    translationLocale?: Locale;
  },
  locale: Locale
): Promise<UpdateTenantSiteSettingsResult> => {
  const [t, sessionId] = await Promise.all([
    getMessagesFor(locale),
    getAccessToken(),
  ]);

  const normalizedTenantId = input.tenantId.trim();

  if (!normalizedTenantId || !sessionId) {
    return {
      message: t("errors.rpc.unauthenticated"),
      ok: false,
    };
  }

  try {
    const response = await apiClient.auth.updateTenantConfig(
      {
        copyrightText: input.copyrightText,
        locale: input.translationLocale ?? "",
        siteDescription: input.siteDescription,
        siteTagline: input.siteTagline,
        tenant: { tenantId: normalizedTenantId },
      },
      withSessionHeaders(sessionId)
    );

    return {
      ok: true,
      settings: {
        copyrightText: response.copyrightText ?? "",
        siteDescription: response.siteDescription ?? "",
        siteTagline: response.siteTagline ?? "",
      },
    };
  } catch (error) {
    rethrowUnauthenticatedRpcError(error);
    rethrowUnclassifiedRpcError(error);

    return {
      // A tab opened before its language was switched off saves into a
      // language the site no longer offers.
      message: rpcErrorHasFieldViolation(error, "locale")
        ? t("admin.settings.site.locale_not_offered")
        : await mapErrorToMessage(
            error,
            t("admin.settings.site.save_failed"),
            locale
          ),
      ok: false,
    };
  }
};
