import { isExpectedNullableRpcError } from "@publira/api-client/errors";
import { AgeVerification, CommentMode } from "@publira/api-client/public/types";
import type { TenantImageVariant as TenantImageVariantMessage } from "@publira/api-client/public/types";
import { parseLocale } from "@publira/i18n";
import type { Locale } from "@publira/i18n";
import { DEFAULT_TIME_ZONE } from "@publira/utils";
import { dropFailedCacheEntry } from "@publira/utils/cached-read";
import { resolveTenantThemeColors } from "@publira/utils/theme-css-variables";
import type { TenantTheme } from "@publira/utils/theme-css-variables";
import { cacheLife } from "next/cache";

import { apiClient } from "./api-client";
import { applyCacheTag, tenantSiteTag, tenantThemeTag } from "./cache-tags";
import { getMessagesFor } from "./messages";
import { publishedPageHrefFromSlug } from "./pages";

/**
 * The locale code the API answered with, or a throw when this build has no
 * catalog for it. `GetTenant` documents `default_locale` as never empty and
 * resolves it against the platform default first, so a value that fails here
 * is a deployment serving a locale its catalogs do not cover.
 */
const requireSupportedLocale = (value: string): Locale => {
  const locale = parseLocale(value);
  if (locale === undefined) {
    throw new Error(`tenant default locale is not supported: ${value}`);
  }

  return locale;
};

/**
 * How this tenant publishes reader comments, in the site's own words rather
 * than the generated enum's. `disabled` is what a tenant that never chose
 * gets, and it is the answer an episode page reads as "no comment section".
 */
export type TenantCommentMode = "approval_required" | "disabled" | "immediate";

/**
 * The generated enum, mapped onto the three modes the site branches on.
 *
 * `COMMENT_MODE_UNSPECIFIED` only reaches a client whose response predates the
 * field — `GetTenant` fails rather than answering with it — and the site reads
 * it the way it reads a tenant that has chosen nothing: commenting is off.
 */
const toTenantCommentMode = (
  mode: CommentMode | undefined
): TenantCommentMode => {
  switch (mode) {
    case CommentMode.IMMEDIATE: {
      return "immediate";
    }
    case CommentMode.APPROVAL_REQUIRED: {
      return "approval_required";
    }
    default: {
      return "disabled";
    }
  }
};

/**
 * Which of this tenant's ratings a reader has to prove an age for. `none` is
 * what a tenant that has chosen nothing gets, and it leaves every rated series
 * to the browser's own confirmation.
 */
export type TenantAgeVerification = "none" | "r15_and_r18" | "r18";

/**
 * The generated enum, mapped onto the three rules the site branches on.
 * Unspecified reads as `none`, which decides only whether a form **asks** for
 * a birth date — the server reads the stored rule when it hands over a body.
 */
const toTenantAgeVerification = (
  ageVerification: AgeVerification | undefined
): TenantAgeVerification => {
  switch (ageVerification) {
    case AgeVerification.R18: {
      return "r18";
    }
    case AgeVerification.R15_AND_R18: {
      return "r15_and_r18";
    }
    default: {
      return "none";
    }
  }
};

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

/**
 * A published page the tenant names as its terms of service or privacy policy.
 * `versionId` is the published version, which a sign-up sends back as the text
 * the reader agreed to.
 */
export interface TenantLegalPage {
  href: string;
  title: string;
  versionId: string;
}

/** Each role is absent where the tenant names no published page for it. */
export interface TenantLegalPages {
  privacyPage?: TenantLegalPage;
  termsPage?: TenantLegalPage;
}

export interface TenantSiteInfo {
  /** Whether the public API verified that Checkout can be offered safely. */
  acceptsPayments: boolean;
  /** Which ratings this tenant makes a reader prove an age for. */
  ageVerification: TenantAgeVerification;
  /**
   * The store listings of the tenant's app, where an episode sold in the app
   * alone sends the reader. Absent where the app is not listed in that store.
   */
  appStoreUrl?: string;
  /** Whether episode pages offer a comment section, and how a post reaches it. */
  commentMode: TenantCommentMode;
  copyrightText?: string;
  /** UI locale a reader gets when the URL does not name one. */
  defaultLocale: Locale;
  domain: string;
  googlePlayUrl?: string;
  /** The terms of service and privacy policy a sign-up asks consent to. */
  legalPages: TenantLegalPages;
  /** The public site's `rel="icon"`; no icon is declared without it. */
  iconImageUpdatedAt?: string;
  iconImageVariants?: TenantImageVariant[];
  /**
   * The public header brand mark. Absent while the tenant has not
   * uploaded a logo.
   */
  logoImageUpdatedAt?: string;
  logoImageVariants?: TenantImageVariant[];
  name: string;
  publicId: string;
  siteDescription?: string;
  siteTagline?: string;
  /** IANA zone every tenant-facing wall clock on the public site is rendered in. */
  timeZone: string;
  /**
   * The VAPID key a browser subscribes with. Absent while the platform has
   * not configured Web Push, which is what the settings screen reads as "this
   * site cannot offer browser notifications".
   */
  webPushVapidPublicKey?: string;
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

const toTenantLegalPage = (
  page: { slug?: string; title?: string; versionId?: string } | undefined
): TenantLegalPage | undefined => {
  const slug = nonEmpty(page?.slug);
  const title = nonEmpty(page?.title);
  const versionId = nonEmpty(page?.versionId);
  if (!slug || !title || !versionId) {
    return undefined;
  }

  return { href: publishedPageHrefFromSlug(slug), title, versionId };
};

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

/**
 * `null` when the tenant does not exist, is not readable, or could not be
 * fetched at all.
 *
 * Site chrome is the only thing this feeds — the header brand, the footer, the
 * `<title>` template — and every one of those is resolved before a static shell
 * exists, in a layout or in `generateMetadata`. A throw there takes the whole
 * route down with a bare 500 that no boundary can reach, so an
 * unavailable API degrades the chrome to its defaults instead. The failed entry
 * is dropped, so the header stops standing in for the tenant's name as soon as
 * the API answers again.
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
      ageVerification: toTenantAgeVerification(response.ageVerification),
      appStoreUrl: nonEmpty(response.appStoreUrl),
      commentMode: toTenantCommentMode(response.commentMode),
      copyrightText: trimmed(response.copyrightText),
      // The server resolves the tenant value against the platform default
      // before answering (`locale.Resolve`), so a code that fails to parse here
      // is one this build does not serve. Rendering the site in some other
      // language would hide that mismatch behind pages nobody asked for.
      defaultLocale: requireSupportedLocale(response.defaultLocale),
      domain: trimmed(response.tenantDomain) ?? "",
      googlePlayUrl: nonEmpty(response.googlePlayUrl),
      iconImageUpdatedAt: nonEmpty(response.theme?.iconImageUpdatedAt),
      iconImageVariants: toTenantImageVariants(
        response.theme?.iconImageVariants
      ),
      legalPages: {
        privacyPage: toTenantLegalPage(response.privacyPage),
        termsPage: toTenantLegalPage(response.termsPage),
      },
      logoImageUpdatedAt: nonEmpty(response.theme?.logoImageUpdatedAt),
      logoImageVariants: toTenantImageVariants(
        response.theme?.logoImageVariants
      ),
      name,
      publicId,
      siteDescription: trimmed(response.siteDescription),
      siteTagline: trimmed(response.siteTagline),
      // The server resolves the zone before answering (`tenanttz.Resolve`), so
      // the fallback only covers a response shape that predates the field.
      timeZone: nonEmpty(response.timezone) ?? DEFAULT_TIME_ZONE,
      webPushVapidPublicKey: nonEmpty(response.webPushVapidPublicKey),
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

/**
 * Reads only the colors used by `GET /theme.css`. It has its own cache entry
 * and tag, rather than sharing site chrome's entry, so an admin theme save can
 * invalidate this stylesheet's source without relying on `tenant:<id>:site`.
 */
export const getTenantTheme = async (
  tenantId: string
): Promise<TenantTheme | null> => {
  "use cache";
  cacheLife({ stale: 30 });

  const normalizedTenantId = tenantId.trim();
  if (!normalizedTenantId) {
    return null;
  }

  applyCacheTag(tenantThemeTag(normalizedTenantId));

  try {
    const response = await apiClient.tenant.getTenant({
      tenant: { tenantId: normalizedTenantId },
    });
    if (!trimmed(response.tenantPublicId)) {
      return null;
    }
    return resolveTenantThemeColors(response.theme);
  } catch (error) {
    if (!isExpectedNullableRpcError(error)) {
      // A cached fill must return a value. Drop the failed entry so the next
      // stylesheet request can recover as soon as the public API does.
      console.warn("[web-host] getTenantTheme failed", error);
      dropFailedCacheEntry();
    }
    return null;
  }
};

/**
 * What the site calls itself: the tenant's own name, or the catalog's stand-in
 * when the tenant has not set one and when the tenant read is unavailable.
 *
 * The stand-in is UI copy, so it cannot live inside {@link getTenantSiteInfo} —
 * that read is cached per tenant and knows nothing about the reader's language.
 */
export const getTenantSiteLabel = async (
  tenantId: string,
  locale: Locale
): Promise<string> => {
  const tenant = await getTenantSiteInfo(tenantId);
  const name = tenant?.name.trim();
  if (name) {
    return name;
  }

  const t = await getMessagesFor(locale);
  return t("host.common.site_fallback");
};

/**
 * Display zone for every date the public site shows a reader. One entry
 * point, so a page never falls back to the fixed `DEFAULT_TIME_ZONE` by
 * omission and the site agrees with the admin console about what the tenant's
 * wall clock is.
 *
 * An unavailable tenant read degrades to {@link DEFAULT_TIME_ZONE} rather than
 * to the host's zone, so the rendered wall clock never depends on where the
 * container runs. The read carries `tenant:<id>:site`, which the admin
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
 * {@link getTenantDisplayTimeZone} is, so no call site names a language on its
 * own and the site agrees with the admin console about what the tenant's
 * default is.
 *
 * `proxy.ts` does **not** use this: the locale-less redirect happens before any
 * route renders, where `"use cache"` reads are unavailable, so it takes the
 * `default_locale` that `GetTenantByDomain` returns alongside the tenant id
 * (`lib/tenant-resolution.ts`). Both paths resolve to the same setting.
 *
 * An unavailable tenant read throws rather than naming a language of its own:
 * the caller is choosing what a reader sees, and a stand-in would show them a
 * site in the wrong language instead of the error the outage actually is. The
 * read carries `tenant:<id>:site`, which the admin API revalidates when the
 * default locale is saved (`tenantDefaultLocaleRevalidateTags`), so a change
 * reaches the site without waiting for the cache to age out.
 */
export const getTenantDefaultLocale = async (
  tenantId: string
): Promise<Locale> => {
  const tenant = await getTenantSiteInfo(tenantId);
  if (!tenant) {
    throw new Error(`tenant default locale is unavailable: ${tenantId}`);
  }

  return tenant.defaultLocale;
};

/**
 * How the tenant publishes reader comments. One entry point, the way
 * {@link getTenantDisplayTimeZone} is, so no episode page decides on its own
 * whether a comment section belongs there.
 *
 * An unavailable tenant read degrades to `disabled`. The setting rides on site
 * chrome, whose failure already renders the page with the tenant's defaults,
 * and a comment box whose every submission the API would refuse is worse for
 * the reader than a section that is briefly missing. The read carries
 * `tenant:<id>:site`, so a saved change reaches the site without waiting for
 * the cache to age out.
 */
export const getTenantCommentMode = async (
  tenantId: string
): Promise<TenantCommentMode> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.commentMode ?? "disabled";
};

/**
 * Which ratings the tenant makes a reader prove an age for. One entry point,
 * the way {@link getTenantDisplayTimeZone} is, so no screen decides on its own
 * whether to ask for a birth date. An unavailable read degrades to `none`,
 * which only stops a form asking — the server still withholds every body.
 */
export const getTenantAgeVerification = async (
  tenantId: string
): Promise<TenantAgeVerification> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.ageVerification ?? "none";
};

/**
 * The pages a sign-up asks the reader to agree to. One entry point, the way
 * {@link getTenantDisplayTimeZone} is, so no screen decides on its own whether
 * consent is asked for.
 *
 * An unavailable read degrades to no pages, which only stops the form asking:
 * the server still refuses a sign-up that carries no consent where the tenant
 * names a page. The read carries `tenant:<id>:site`, which the API drops when a
 * nomination or a named page changes.
 */
export const getTenantLegalPages = async (
  tenantId: string
): Promise<TenantLegalPages> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.legalPages ?? {};
};

/**
 * The pages a sign-up asks consent to, each once: a page named for both roles
 * is one page, and the API takes exactly one version of it.
 */
export const consentPages = ({
  privacyPage,
  termsPage,
}: TenantLegalPages): TenantLegalPage[] => [
  ...(termsPage ? [termsPage] : []),
  ...(privacyPage && privacyPage.versionId !== termsPage?.versionId
    ? [privacyPage]
    : []),
];

/**
 * The versions a sign-up would ask consent to right now, read past the cache.
 * The cached read can hold a version the tenant has since superseded, and a
 * sign-up must record only text the reader could have been shown.
 */
export const readConsentPageVersionIds = async (
  tenantId: string
): Promise<string[]> => {
  const response = await apiClient.tenant.getTenant({
    tenant: { tenantId: tenantId.trim() },
  });

  return consentPages({
    privacyPage: toTenantLegalPage(response.privacyPage),
    termsPage: toTenantLegalPage(response.termsPage),
  }).map((page) => page.versionId);
};

/**
 * The VAPID public key a browser subscribes to Web Push with, or `null` when
 * the platform has not configured Web Push. One entry point, the way
 * {@link getTenantDisplayTimeZone} is, so no screen decides on its own whether
 * browser notifications can be offered.
 *
 * An unavailable tenant read degrades to `null`, the same answer an unset key
 * gives: a switch whose subscription the API would refuse is worse for the
 * reader than one that is briefly missing. The read carries `tenant:<id>:site`,
 * so a platform that configures Web Push serves the switch as soon as that
 * entry ages out.
 */
export const getTenantWebPushPublicKey = async (
  tenantId: string
): Promise<string | null> => {
  const tenant = await getTenantSiteInfo(tenantId);
  return tenant?.webPushVapidPublicKey ?? null;
};

/**
 * The origin every URL that leaves this site is written against — the address
 * a reader pastes into a chat, and the one a crawler fetches an Open Graph
 * image from. One entry point, the way {@link getTenantDisplayTimeZone} is, so
 * no screen decides on its own where the tenant lives.
 *
 * It is the tenant's stored domain rather than the request's `Host`, which is
 * the same choice the Go server makes when it writes a link into mail
 * (`outbox`): a reader who reached the site through some other name still
 * shares the address the tenant publishes under. `https` because that is the
 * only scheme a tenant domain is served over.
 *
 * `null` where the tenant read is unavailable or the domain is unset. Both
 * cases leave a caller with no address to write, and the controls that need one
 * — sharing, Open Graph — are absent for that request rather than pointing at
 * a guess.
 */
export const getTenantPublicOrigin = async (
  tenantId: string
): Promise<string | null> => {
  const tenant = await getTenantSiteInfo(tenantId);
  const domain = tenant?.domain.trim();

  return domain ? `https://${domain}` : null;
};
