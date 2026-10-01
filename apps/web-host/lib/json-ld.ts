import type { Locale } from "@publira/i18n";
import type {
  BreadcrumbList,
  ComicIssue,
  ComicSeries,
  Organization,
  Person,
  ProfilePage,
  Thing,
  WebSite,
  WithContext,
} from "schema-dts";

import type {
  CreatorCredit,
  EpisodeAccessState,
  EpisodeDetail,
  EpisodeSeriesSummary,
  EyeCatchImageVariant,
  SeriesDetail,
} from "./catalog";
import type { PublishedCreatorDetail } from "./creators";
import { withLocalePrefix } from "./locale-path";
import {
  getTenantPublicOrigin,
  getTenantSiteInfo,
  getTenantSiteLabel,
} from "./tenant";
import type { TenantSiteInfo } from "./tenant";
import { resolveTenantLogoVariant } from "./tenant-logo";

/**
 * What every document needs to name a page: the tenant's origin, the locale
 * the page is served in and the one that goes unprefixed, and the site's name
 * for the first step of a breadcrumb trail. `tenant` carries what the
 * organization document says about the tenant beyond its name.
 */
export interface JsonLdSite {
  defaultLocale: Locale;
  locale: Locale;
  name: string;
  origin: string;
  tenant: Pick<
    TenantSiteInfo,
    "appStoreUrl" | "googlePlayUrl" | "logoImageVariants"
  >;
}

/**
 * The {@link JsonLdSite} for one tenant and locale, or `null` where the
 * tenant's origin is unavailable. That is the same condition under which the
 * root layout has no `metadataBase` and the pages drop their alternates: a
 * document whose `url` and `@id` cannot be absolute is not written at all
 * rather than written against a guess.
 */
export const getJsonLdSite = async (
  tenantId: string,
  locale: Locale
): Promise<JsonLdSite | null> => {
  const [origin, tenant] = await Promise.all([
    getTenantPublicOrigin(tenantId),
    getTenantSiteInfo(tenantId),
  ]);
  if (!(origin && tenant)) {
    return null;
  }

  return {
    defaultLocale: tenant.defaultLocale,
    locale,
    name: await getTenantSiteLabel(tenantId, locale),
    origin,
    tenant: {
      appStoreUrl: tenant.appStoreUrl,
      googlePlayUrl: tenant.googlePlayUrl,
      logoImageVariants: tenant.logoImageVariants,
    },
  };
};

/**
 * The absolute address of an app-internal path in the site's locale, written
 * the way Next.js writes `link[rel=canonical]` from the same path against
 * `metadataBase`: the bare origin for the root, with no trailing slash. A
 * document's `url` is then the page's canonical character for character.
 */
export const jsonLdUrl = (site: JsonLdSite, href: string): string => {
  const url = new URL(
    withLocalePrefix(site.locale, site.defaultLocale, href),
    site.origin
  );
  return url.pathname === "/" && url.search === "" ? url.origin : url.href;
};

/**
 * An image path the API answered with, against the tenant's origin. The image
 * server's paths are relative (`/images/series/…`): metadata resolves them
 * against `metadataBase`, and a JSON-LD document has nothing that would.
 */
const absoluteUrl = (site: JsonLdSite, path: string): string =>
  new URL(path, site.origin).href;

/**
 * The organization the site is, which every document's publisher refers to.
 * Its `@id` lives on the top page, where {@link organizationJsonLd} describes
 * it in full.
 */
const organizationId = (site: JsonLdSite): string =>
  `${jsonLdUrl(site, "/")}#organization`;

/** A creator's page, and the `@id` of the person it is about. */
const creatorHref = (publicId: string): string => `/creators/${publicId}`;

const personId = (site: JsonLdSite, publicId: string): string =>
  `${jsonLdUrl(site, creatorHref(publicId))}#person`;

const seriesHref = (publicId: string): string => `/series/${publicId}`;

const seriesId = (site: JsonLdSite, publicId: string): string =>
  `${jsonLdUrl(site, seriesHref(publicId))}#series`;

/**
 * Each credited person once, in the order the API credits them. A creator who
 * holds two roles on a work is listed under both on the page, but is one
 * author of it. A credit without a public id still names a person; it just
 * has no page to point at.
 */
const creditAuthors = (
  site: JsonLdSite,
  credits: readonly CreatorCredit[]
): Person[] => {
  const seen = new Set<string>();
  const authors: Person[] = [];
  for (const credit of credits) {
    const key = credit.publicId || `name:${credit.name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    authors.push(
      credit.publicId
        ? {
            "@id": personId(site, credit.publicId),
            "@type": "Person",
            name: credit.name,
            url: jsonLdUrl(site, creatorHref(credit.publicId)),
          }
        : { "@type": "Person", name: credit.name }
    );
  }
  return authors;
};

/**
 * The ratios a search engine crops a work's picture from — wide, square, and
 * the portrait cover — at the largest size the image server keeps of each.
 * The `og` crop is left out: it exists for link cards, and repeats the wide
 * one at a ratio nothing else asks for.
 */
const SEARCH_IMAGE_VARIANT_TYPES = ["landscape", "square", "portrait"];

const workImages = (
  site: JsonLdSite,
  variants: readonly EyeCatchImageVariant[] | undefined
): string[] =>
  SEARCH_IMAGE_VARIANT_TYPES.flatMap((variantType) => {
    let largest: EyeCatchImageVariant | null = null;
    for (const variant of variants ?? []) {
      if (
        variant.variantType === variantType &&
        (!largest || variant.width > largest.width)
      ) {
        largest = variant;
      }
    }
    return largest ? [absoluteUrl(site, largest.url)] : [];
  });

/**
 * The work's publisher: its label where the tenant filed it under one, and
 * the tenant itself otherwise.
 */
const seriesPublisher = (
  site: JsonLdSite,
  series: Pick<SeriesDetail, "labelName" | "labelPublicId">
): Organization => {
  if (series.labelName) {
    return series.labelPublicId
      ? {
          "@type": "Organization",
          name: series.labelName,
          url: jsonLdUrl(site, `/labels/${series.labelPublicId}`),
        }
      : { "@type": "Organization", name: series.labelName };
  }

  return {
    "@id": organizationId(site),
    "@type": "Organization",
    name: site.name,
    url: jsonLdUrl(site, "/"),
  };
};

/**
 * The site itself, which is what lets a search engine show the tenant's name
 * in place of its domain. `inLanguage` is the UI language the URL names; it
 * describes this document's chrome and is the only document that carries it,
 * because the works' own text is tenant-authored and untranslated.
 */
export const websiteJsonLd = (site: JsonLdSite): WithContext<WebSite> => {
  const url = jsonLdUrl(site, "/");
  return {
    "@context": "https://schema.org",
    "@id": `${url}#website`,
    "@type": "WebSite",
    inLanguage: site.locale,
    name: site.name,
    publisher: { "@id": organizationId(site) },
    url,
  };
};

/**
 * The tenant as the organization behind the site. The app store listings are
 * the other places it publishes under its own name, so they are its `sameAs`.
 */
export const organizationJsonLd = (
  site: JsonLdSite
): WithContext<Organization> => {
  const { tenant } = site;
  const logo = resolveTenantLogoVariant(tenant);
  const sameAs = [tenant.appStoreUrl, tenant.googlePlayUrl].filter(
    (url): url is string => Boolean(url)
  );

  return {
    "@context": "https://schema.org",
    "@id": organizationId(site),
    "@type": "Organization",
    name: site.name,
    url: jsonLdUrl(site, "/"),
    ...(logo ? { logo: absoluteUrl(site, logo.url) } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
};

/**
 * A work. `aggregateRating` is written only once readers have rated it: a
 * figure of 0 is the API's "no figure yet", not the bottom of the 1–5 scale.
 */
export const seriesJsonLd = (
  site: JsonLdSite,
  series: Pick<
    SeriesDetail,
    | "credits"
    | "eyeCatchImageVariants"
    | "genres"
    | "labelName"
    | "labelPublicId"
    | "publicId"
    | "ratingAverage"
    | "ratingCount"
    | "synopsis"
    | "tags"
    | "title"
  >
): WithContext<ComicSeries> => {
  const description = series.synopsis.trim();
  const authors = creditAuthors(site, series.credits);
  const images = workImages(site, series.eyeCatchImageVariants);

  return {
    "@context": "https://schema.org",
    "@id": seriesId(site, series.publicId),
    "@type": "ComicSeries",
    name: series.title,
    publisher: seriesPublisher(site, series),
    url: jsonLdUrl(site, seriesHref(series.publicId)),
    ...(description ? { description } : {}),
    ...(images.length > 0 ? { image: images } : {}),
    ...(authors.length > 0 ? { author: authors } : {}),
    ...(series.genres.length > 0
      ? { genre: series.genres.map((genre) => genre.name) }
      : {}),
    ...(series.tags.length > 0
      ? { keywords: series.tags.map((tag) => tag.name) }
      : {}),
    ...(series.ratingCount > 0 && series.ratingAverage > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            bestRating: 5,
            ratingCount: series.ratingCount,
            ratingValue: series.ratingAverage,
            worstRating: 1,
          },
        }
      : {}),
  };
};

/**
 * Whether the episode body is open to every reader, from the anonymous read
 * the page renders. `entitled` is a grant on a body that is not free — the
 * API answers `free` before it looks for one — and `age_restricted` withholds
 * the price along with the body, so that episode states nothing.
 */
const isAccessibleForFree = (
  access: EpisodeAccessState
): boolean | undefined => {
  switch (access) {
    case "free": {
      return true;
    }
    case "entitled":
    case "locked": {
      return false;
    }
    default: {
      return undefined;
    }
  }
};

/**
 * One episode, as an issue of its work. The work is referred to by its `@id`
 * rather than described again, and the episode carries no rating: its count
 * is a headcount of readers with no average behind it.
 */
export const episodeJsonLd = (
  site: JsonLdSite,
  {
    access,
    episode,
    series,
  }: {
    access: EpisodeAccessState;
    episode: Pick<
      EpisodeDetail,
      "credits" | "orderIndex" | "publicId" | "publishedAt" | "title"
    >;
    series: Pick<EpisodeSeriesSummary, "publicId" | "title">;
  }
): WithContext<ComicIssue> => {
  const url = jsonLdUrl(
    site,
    `${seriesHref(series.publicId)}/episodes/${episode.publicId}`
  );
  const authors = creditAuthors(site, episode.credits);
  const free = isAccessibleForFree(access);

  return {
    "@context": "https://schema.org",
    "@id": `${url}#issue`,
    "@type": "ComicIssue",
    isPartOf: {
      "@id": seriesId(site, series.publicId),
      "@type": "ComicSeries",
      name: series.title,
      url: jsonLdUrl(site, seriesHref(series.publicId)),
    },
    issueNumber: episode.orderIndex,
    name: episode.title,
    url,
    ...(episode.publishedAt ? { datePublished: episode.publishedAt } : {}),
    ...(authors.length > 0 ? { author: authors } : {}),
    ...(free === undefined ? {} : { isAccessibleForFree: free }),
  };
};

/**
 * A creator's page, about the person whose `@id` every work crediting them
 * refers to.
 */
export const creatorJsonLd = (
  site: JsonLdSite,
  creator: Pick<
    PublishedCreatorDetail,
    "iconImageUrl" | "id" | "name" | "profileText"
  >
): WithContext<ProfilePage> => {
  const url = jsonLdUrl(site, creatorHref(creator.id));
  const description = creator.profileText.trim();

  return {
    "@context": "https://schema.org",
    "@id": `${url}#profile`,
    "@type": "ProfilePage",
    mainEntity: {
      "@id": personId(site, creator.id),
      "@type": "Person",
      name: creator.name,
      url,
      ...(description ? { description } : {}),
      ...(creator.iconImageUrl
        ? { image: absoluteUrl(site, creator.iconImageUrl) }
        : {}),
    },
    url,
  };
};

/** One step of a trail below the top page. */
export interface JsonLdCrumb {
  href: string;
  name: string;
}

/**
 * The trail from the top page down to the page at the end of `crumbs`. It
 * follows the route hierarchy, which is the path a reader navigates; the site
 * draws no visible breadcrumb for it to mirror.
 */
export const breadcrumbJsonLd = (
  site: JsonLdSite,
  crumbs: readonly JsonLdCrumb[]
): WithContext<BreadcrumbList> => {
  const trail = [{ href: "/", name: site.name }, ...crumbs];
  const last = trail.at(-1) ?? trail[0];

  return {
    "@context": "https://schema.org",
    "@id": `${jsonLdUrl(site, last.href)}#breadcrumb`,
    "@type": "BreadcrumbList",
    itemListElement: trail.map((crumb, index) => ({
      "@type": "ListItem",
      item: jsonLdUrl(site, crumb.href),
      name: crumb.name,
      position: index + 1,
    })),
  };
};

/**
 * A document as the text of a `<script type="application/ld+json">`. The
 * element's content ends at the first `</script`, whatever the JSON around it
 * says, so every `<` is written as its escape: tenant-authored text such as a
 * synopsis cannot close the element and put markup into the page. The escape
 * is still JSON, so the parsed document is unchanged.
 */
export const serializeJsonLd = (document: WithContext<Thing>): string =>
  JSON.stringify(document).replaceAll("<", "\\u003c");
