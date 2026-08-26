import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import type { TenantImageVariant as TenantImageVariantMessage } from "@publira/api-client/public/types";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { DEFAULT_LOCALE, parseLocale } from "@publira/utils/i18n";
import type { Locale } from "@publira/utils/i18n";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantThemeColors } from "@publira/utils/theme-css-variables";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantSiteTag } from "./cache-tags";

/**
 * A stored tenant branding image, carried the way the eye-catch variants are
 * (`catalog.ts`). Absent while the tenant has not uploaded one.
 */
export interface TenantImageVariant {
  label: string;
  variantType: string;
  url: string;
  contentType: string;
  width: number;
  height: number;
  fileSizeBytes: number;
}

export interface TenantSiteInfo {
  /** Whether the public API verified that Checkout can be offered safely. */
  acceptsPayments: boolean;
  copyrightText?: string;
  /** UI locale a reader gets when the URL does not name one. */
  defaultLocale: Locale;
  domain: string;
  /** The public site's `rel="icon"` (#549); no icon is declared without it. */
  iconImageUpdatedAt?: string;
  iconImageVariants?: TenantImageVariant[];
  /**
   * The public header brand mark (#542). Absent while the tenant has not
   * uploaded a logo.
   */
  logoImageUpdatedAt?: string;
  logoImageVariants?: TenantImageVariant[];
  name: string;
  publicId: string;
  siteDescription?: string;
  siteLabel: string;
  siteTagline?: string;
  theme: TenantThemeColors;
  /** IANA zone every tenant-facing wall clock on the public site is rendered in. */
  timeZone: string;
}

/**
 * Proto scalars arrive as `""` rather than absent, so an optional field has to
 * be narrowed before it lands on {@link TenantSiteInfo}. `trimmed` keeps an
 * empty string as an empty string; `nonEmpty` drops it, for the fields whose
 * consumers distinguish "unset" from "set to nothing".
 */
const trimmed = (value?: string): string | undefined => value?.trim();
const nonEmpty = (value?: string): string | undefined =>
  value?.trim() || undefined;

/**
 * The generated `TenantImageVariant` fields {@link toTenantImageVariants} reads
 * (see `catalog.ts`).
 */
type RawTenantImageVariant = Pick<
  TenantImageVariantMessage,
  | "contentType"
  | "fileSizeBytes"
  | "height"
  | "label"
  | "url"
  | "variantType"
  | "width"
>;

const toTenantImageVariants = (
  variants: RawTenantImageVariant[] | undefined
): TenantImageVariant[] | undefined => {
  const mapped = (variants ?? []).flatMap((variant) => {
    const mappedVariant = {
      contentType: variant.contentType ?? "",
      fileSizeBytes: Number(variant.fileSizeBytes ?? 0),
      height: variant.height ?? 0,
      label: variant.label ?? "",
      url: variant.url ?? "",
      variantType: variant.variantType ?? "",
      width: variant.width ?? 0,
    };
    return mappedVariant.label.length > 0 && mappedVariant.url.length > 0
      ? [mappedVariant]
      : [];
  });

  return mapped.length > 0 ? mapped : undefined;
};

const buildTenantSiteLabel = (tenantName: string): string => {
  const normalizedTenantName = tenantName.trim();
  return normalizedTenantName || "サイト";
};

/**
 * `null` when the tenant does not exist, is not readable, or could not be
 * fetched at all.
 *
 * Site chrome is the only thing this feeds — the header brand, the footer, the
 * `<title>` template — and every one of those is resolved before a static shell
 * exists, in a layout or in `generateMetadata`. A throw there takes the whole
 * route down with a bare 500 that no boundary can reach (#672), so an
 * unavailable API degrades the chrome to its defaults instead. The failed entry
 * is dropped, so the header stops saying 「サイト」 as soon as the API answers
 * again.
 *
 * Callers cannot tell "no tenant" from "could not ask" — deliberately: both
 * render the same defaults, and the distinction has no reader-facing meaning.
 */
export const getTenantSiteInfo = async (
  tenantId: string
): Promise<TenantSiteInfo | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantSiteTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenant({
      tenant: { tenantId: normalizedTenantId },
    });

    // Display / short code for UI — not used for internal routing.
    const publicId = trimmed(response.tenantPublicId) ?? "";
    if (!publicId) {
      return null;
    }

    const name = trimmed(response.tenantName) ?? "";

    return {
      acceptsPayments: response.acceptsPayments === true,
      copyrightText: trimmed(response.copyrightText),
      // The server resolves the tenant value against the platform default
      // before answering (`locale.Resolve`), so `parseLocale` only catches a
      // code this build does not serve.
      defaultLocale: parseLocale(response.defaultLocale),
      domain: trimmed(response.tenantDomain) ?? "",
      iconImageUpdatedAt: nonEmpty(response.theme?.iconImageUpdatedAt),
      iconImageVariants: toTenantImageVariants(
        response.theme?.iconImageVariants
      ),
      logoImageUpdatedAt: nonEmpty(response.theme?.logoImageUpdatedAt),
      logoImageVariants: toTenantImageVariants(
        response.theme?.logoImageVariants
      ),
      name,
      publicId,
      siteDescription: trimmed(response.siteDescription),
      siteLabel: buildTenantSiteLabel(name),
      siteTagline: trimmed(response.siteTagline),
      theme: resolveTenantThemeColors(response.theme),
      // The server resolves the zone before answering (`tenanttz.Resolve`), so
      // the fallback only covers a response shape that predates the field.
      timeZone: nonEmpty(response.timezone) ?? DEFAULT_TIME_ZONE,
    };
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      // Not "no such tenant" but "we could not ask". Same `null` for the reader,
      // and the entry is dropped so the chrome recovers on the next request.
      console.warn("[web-host] getTenantSiteInfo failed", error);
      dropFailedCacheEntry();
    }
    return null;
  }
};

export const getTenantSiteLabel = async (tenantId: string): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.siteLabel ?? "サイト";
};

/**
 * Display zone for every date the public site shows a reader (#567). One entry
 * point, so a page never falls back to the fixed `DEFAULT_TIME_ZONE` by
 * omission and the site agrees with the admin console about what the tenant's
 * wall clock is.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_TIME_ZONE} rather than
 * to the host's zone, so the rendered wall clock never depends on where the
 * container runs (#564). The read carries `tenant:<id>:site`, which the admin
 * API revalidates when the zone is saved (`tenantTimezoneRevalidateTags`), so a
 * change reaches the site without waiting for the cache to age out.
 */
export const getTenantDisplayTimeZone = async (
  tenantId: string
): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.timeZone ?? DEFAULT_TIME_ZONE;
};

/**
 * The tenant's default UI locale, for server-side code that has to name a
 * language the reader did not choose. One entry point, the way
 * {@link getTenantDisplayTimeZone} is, so no call site reaches for
 * {@link DEFAULT_LOCALE} on its own and the site agrees with the admin console
 * about what the tenant's default is.
 *
 * `proxy.ts` does **not** use this: the locale-less redirect happens before any
 * route renders, where `"use cache"` reads are unavailable, so it takes the
 * `default_locale` that `GetTenantByDomain` returns alongside the tenant id
 * (`lib/tenant-resolution.ts`). Both paths resolve to the same setting.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_LOCALE} rather than
 * failing the render. The read carries `tenant:<id>:site`, which the admin API
 * revalidates when the default locale is saved
 * (`tenantDefaultLocaleRevalidateTags`), so a change reaches the site without
 * waiting for the cache to age out.
 */
export const getTenantDefaultLocale = async (
  tenantId: string
): Promise<Locale> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.defaultLocale ?? DEFAULT_LOCALE;
};
