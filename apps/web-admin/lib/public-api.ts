import { isMissingResourceRpcError } from "@publira/api-client/errors";
import { createPublicApiClient } from "@publira/api-client/public/client";
import { getLocales, parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantTheme } from "@publira/utils/theme-css-variables";
import { LRUCache } from "lru-cache";
import { cacheLife, cacheTag } from "next/cache";

import { readCurrency } from "./price";

/**
 * The public API, which the console reads for the few things the admin API
 * cannot answer: the tenant chrome below, resolved before there is a session,
 * and the tag vocabulary in `tag.ts`, which has no admin RPC of its own.
 *
 * `PUBLIRA_PUBLIC_GRPC_URL` lets it be a different `publira server` from the
 * one the admin API is called on, so that one can run `--role admin,platform`
 * while this one runs `--role storefront`. Unset, both are the same server.
 */
export const publicApiClient = createPublicApiClient({
  baseUrl:
    process.env.PUBLIRA_PUBLIC_GRPC_URL ??
    process.env.PUBLIRA_GRPC_URL ??
    "http://localhost:8000/rpc",
  transport: "grpc",
});

interface TenantPublicInfo {
  /**
   * ISO 4217 code of the currency the tenant sells in, which every price and
   * amount the console shows or takes is an integer in the minor unit of.
   * `GetTenant` answers it as never empty, so `null` only for a response that
   * is not one.
   */
  currency: string | null;
  /**
   * The tenant's stored default locale. `GetTenant` documents it as never
   * empty and resolves it against the platform default first, so `null` means
   * this build serves no catalog for the code the API answered with.
   */
  defaultLocale: Locale | null;
  name: string | null;
  /**
   * The locales the tenant's site offers, in the registry's order, its default
   * among them. `null` when the response names none this build serves a
   * catalog for, as {@link defaultLocale} is.
   */
  supportedLocales: readonly Locale[] | null;
  theme: TenantTheme;
  /**
   * The IANA zone the tenant's wall clock is in, already resolved against the
   * platform default, so `null` only for a response that predates the field.
   */
  timezone: string | null;
}

/**
 * The tag the public tenant read carries. The API drops it in every app for
 * some of the settings it answers — the time zone and the default locale among
 * them — and the console's own Actions drop it for every one they save, so the
 * operator who saved sees the change on the screen they return to rather than
 * once a revalidation lands.
 */
export const tenantSiteCacheTag = (tenantId: string): string =>
  `tenant:${tenantId.trim()}:site`;

const applyTenantSiteCacheTag = (tenantId: string) => {
  try {
    cacheTag(tenantSiteCacheTag(tenantId));
  } catch {
    // Some unit tests run without Next cacheComponents runtime support.
  }
};

/**
 * A set of offered locales as the API answers it, kept to the codes this build
 * serves and put in the registry's order, which the API already answers it in.
 */
export const readSupportedLocales = (
  codes: readonly string[] | undefined
): readonly Locale[] | null => {
  const offered = new Set(codes?.map((code) => parseLocale(code.trim())));
  const locales = getLocales().filter((code) => offered.has(code));

  return locales.length > 0 ? locales : null;
};

/**
 * The tenant as the public `GetTenant` answers it, or `null` when it cannot be
 * read. That answer is the same for everyone, so it is cached once per tenant
 * — the values the console would otherwise read per operator through the
 * admin API's settings RPCs come from here too.
 */
export const getTenantPublicInfo = async (
  tenantId: string
): Promise<TenantPublicInfo | null> => {
  "use cache";
  cacheLife("hours");

  const normalized = tenantId.trim();

  if (!normalized) {
    return null;
  }

  applyTenantSiteCacheTag(normalized);

  try {
    const response = await publicApiClient.tenant.getTenant({
      tenant: { tenantId: normalized },
    });

    return {
      currency: readCurrency(response.currency),
      defaultLocale: parseLocale(response.defaultLocale.trim()) ?? null,
      name: response.tenantName?.trim() || null,
      supportedLocales: readSupportedLocales(response.supportedLocales),
      theme: resolveTenantThemeColors(response.theme),
      timezone: response.timezone?.trim() || null,
    };
  } catch (error) {
    if (!isMissingResourceRpcError(error)) {
      // The tenant name in `<title>` and the theme colours are resolved
      // before a static shell exists, where a throw from a `"use cache"` fill
      // answers a bare 500 for the whole route instead of reaching any
      // boundary; the readers that word a failure do so from `null`. The
      // entry is dropped, so the real values come back as soon as the public
      // API does.
      console.warn("[web-admin] getTenantPublicInfo failed", error);
      dropFailedCacheEntry();
    }

    return null;
  }
};

/**
 * The currency the tenant sells in, or `null` when it cannot be read. A price
 * shown or entered without it would be a number in no currency, so a screen
 * that has `null` says the amount is unavailable rather than guessing one. The
 * read carries `tenant:<id>:site`, which the admin API revalidates when the
 * payment settings are saved, and the payment settings Action drops as well,
 * and which a change of the platform's default currency drops for every
 * tenant that sells in it.
 */
export const getTenantCurrency = async (
  tenantId: string
): Promise<string | null> => {
  const info = await getTenantPublicInfo(tenantId);

  return info?.currency ?? null;
};

export const getTenantName = async (
  tenantId: string
): Promise<string | null> => {
  const info = await getTenantPublicInfo(tenantId);

  return info?.name ?? null;
};

export const getTenantThemeColors = async (
  tenantId: string
): Promise<TenantTheme | null> => {
  const info = await getTenantPublicInfo(tenantId);

  return info?.theme ?? null;
};

/**
 * The tenant's default UI locale, or `null` when it cannot be read.
 *
 * This is what an unauthenticated console screen renders in: the login form has
 * no operator to have a cookie yet, and the admin API's own
 * `GetTenantDefaultLocale` needs the session that screen exists to create.
 * `GetTenant` answers the same stored value without one, and the read carries
 * `tenant:<id>:site`, which the admin API revalidates when the setting is saved
 * (`tenantDefaultLocaleRevalidateTags`), so a change reaches the console as
 * soon as it reaches the site.
 *
 * Use this only where `null` has an answer of its own — `<html lang>`, which
 * says nothing rather than naming a language it did not resolve. Everything
 * that renders copy wants {@link getTenantDisplayLocale}.
 */
export const findTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale | null> => {
  const info = await getTenantPublicInfo(tenantId);

  return info?.defaultLocale ?? null;
};

/**
 * The last locale the public API confirmed for each tenant, for this server
 * process.
 *
 * Bounded because the console serves many tenants and this outlives any one
 * request; the size is a ceiling on distinct tenants seen recently, not a
 * freshness window — a tenant that saves a new default gets it from the cached
 * read above, which `tenant:<id>:site` revalidates.
 */
const lastConfirmedTenantLocale = new LRUCache<string, Locale>({ max: 500 });

/**
 * The tenant's default UI locale.
 *
 * An outage does not change what the tenant saved, so it must not change the
 * language the console renders in — and it must not stop the console rendering
 * at all. This read is the one the shell resolves before any `<Suspense>`
 * boundary exists, where a throw answers a bare 500 instead of reaching the
 * error screen, so a failed read reports the last locale the API did
 * confirm rather than giving up.
 *
 * Only a process that has never had an answer for this tenant throws: there is
 * then nothing that says what language the console is in, and a page in one
 * nobody chose would hide the outage behind chrome that looks like it worked.
 */
export const getTenantDisplayLocale = async (
  tenantId: string
): Promise<Locale> => {
  const defaultLocale = await findTenantDisplayLocale(tenantId);

  if (defaultLocale) {
    lastConfirmedTenantLocale.set(tenantId, defaultLocale);

    return defaultLocale;
  }

  const lastConfirmed = lastConfirmedTenantLocale.get(tenantId);

  if (lastConfirmed) {
    return lastConfirmed;
  }

  throw new Error(`tenant default locale is unavailable: ${tenantId}`);
};
