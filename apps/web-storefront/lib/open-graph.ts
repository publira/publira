import type { Metadata } from "next";

import type { RestrictedAgeRating } from "./age-rating";
import type { EyeCatchImageVariant } from "./catalog";
import type { LocaleAlternates } from "./locale-path";

/**
 * The ratio the image server crops an eye-catch to for a link preview — 1200
 * by 630, the size every card renderer states as its own (`imageproc`). The
 * other three ratios are what the site itself draws, and a card built from one
 * of those is letterboxed or cropped by whoever renders it.
 */
const OPEN_GRAPH_VARIANT_TYPE = "og";

/**
 * The size of the card the storefront draws itself (`lib/open-graph-card.tsx`)
 * where a work has no artwork of its own: the size the image server crops an
 * eye-catch to, so both kinds of card are framed alike.
 */
export const OPEN_GRAPH_CARD_WIDTH = 1200;
export const OPEN_GRAPH_CARD_HEIGHT = 630;

/**
 * One image on a card, at the URL the API answered: a path `metadataBase`
 * resolves for a crawler, or an absolute URL on the tenant's image host.
 */
export interface OpenGraphImage {
  alt: string;
  height: number;
  url: string;
  width: number;
}

/**
 * The card image for a work, or `undefined` where the tenant has uploaded no
 * eye-catch — never a picture that is not the work's own.
 *
 * The largest `og` variant, because a crawler downsamples and nothing upsamples.
 */
export const resolveOpenGraphImage = (
  variants: EyeCatchImageVariant[] | undefined,
  alt: string
): OpenGraphImage | undefined => {
  let largest: EyeCatchImageVariant | null = null;

  for (const variant of variants ?? []) {
    if (variant.variantType !== OPEN_GRAPH_VARIANT_TYPE) {
      continue;
    }

    if (!largest || variant.width > largest.width) {
      largest = variant;
    }
  }

  if (!largest) {
    return undefined;
  }

  return {
    alt,
    height: largest.height,
    url: largest.url,
    width: largest.width,
  };
};

/**
 * The card the storefront draws for a subject, at the path
 * `openGraphCardPath` gives it with the page's locale prefix.
 */
export const openGraphCardImage = (
  url: string,
  alt: string
): OpenGraphImage => ({
  alt,
  url,
  height: OPEN_GRAPH_CARD_HEIGHT,
  width: OPEN_GRAPH_CARD_WIDTH,
});

/** The artwork one card could be built from, and the text it is described by. */
interface OpenGraphSource {
  alt: string;
  variants: EyeCatchImageVariant[] | undefined;
}

/**
 * A work's artwork with the rating that governs it. The rating is required,
 * not optional, so a call site that forgets it fails to compile instead of
 * sharing a rated work's artwork.
 */
interface OpenGraphWork extends OpenGraphSource {
  ageRating: RestrictedAgeRating | undefined;
}

/**
 * The card image for a series: its uploaded eye-catch where it has an `og`
 * variant, untouched, and the card the storefront draws at `cardUrl` where it
 * has none.
 *
 * A rated series always gets the drawn card. The site shows a rated work's
 * artwork only once the browser has confirmed the rating
 * (`AgeRatedVisibility`), and a link preview is rendered by a chat or a social
 * network for everyone the link reaches, with nobody asked to confirm
 * anything. The drawn card carries the title, the logo, and the theme's
 * colors, none of which the rating withholds.
 */
export const resolveSeriesOpenGraphImage = (
  series: OpenGraphWork,
  cardUrl: string
): OpenGraphImage => {
  if (series.ageRating) {
    return openGraphCardImage(cardUrl, series.alt);
  }

  return (
    resolveOpenGraphImage(series.variants, series.alt) ??
    openGraphCardImage(cardUrl, series.alt)
  );
};

/**
 * The card image for an episode: its own eye-catch where it has an `og`
 * variant, its series' where it does not, and the card the storefront draws
 * at `cardUrl` where neither has one — so an episode without artwork still
 * unfurls with the work's picture before it falls back on a drawn one.
 *
 * The series' rating covers the episode's own artwork too, so an episode of a
 * rated series always gets the drawn card, for the reason
 * {@link resolveSeriesOpenGraphImage} gives.
 */
export const resolveEpisodeOpenGraphImage = (
  episode: OpenGraphSource,
  series: OpenGraphWork,
  cardUrl: string
): OpenGraphImage => {
  if (series.ageRating) {
    return openGraphCardImage(cardUrl, episode.alt);
  }

  return (
    resolveOpenGraphImage(episode.variants, episode.alt) ??
    resolveOpenGraphImage(series.variants, series.alt) ??
    openGraphCardImage(cardUrl, episode.alt)
  );
};

interface OpenGraphCard {
  description?: string;
  image: OpenGraphImage | undefined;
  siteName: string;
  title: string;
  type: "article" | "website";
  url?: string;
}

/**
 * A page's `openGraph` and `twitter`, which say the same thing to the two
 * kinds of crawler. A page that sets `openGraph` replaces the `(site)`
 * layout's whole object rather than merging into it, so each sets every field
 * it means to carry.
 */
export const openGraphMetadata = ({
  description,
  image,
  siteName,
  title,
  type,
  url,
}: OpenGraphCard): Pick<Metadata, "openGraph" | "twitter"> => ({
  openGraph: { images: image, description, siteName, title, type, url },
  twitter: {
    card: "summary_large_image",
    images: image,
    description,
    title,
  },
});

/** The site's own card, which a page with no picture of its own unfurls with. */
export interface SiteOpenGraphCard {
  description: string | undefined;
  image: OpenGraphImage | undefined;
  siteName: string;
}

interface PageOpenGraphCard {
  alternates: LocaleAlternates | undefined;
  description?: string;
  site: SiteOpenGraphCard;
  title: string;
  type?: "article" | "website";
}

/**
 * {@link openGraphMetadata} for a page with no picture of its own: its own
 * title, canonical URL, and description, on the site's card image. A page
 * that sets none inherits the `(site)` layout's card whole, and unfurls under
 * the site's name with no URL.
 *
 * Without a description of its own, the card carries the site's, which is
 * also the `<meta name="description">` such a page inherits.
 */
export const pageOpenGraphMetadata = ({
  alternates,
  description,
  site,
  title,
  type = "website",
}: PageOpenGraphCard): Pick<Metadata, "openGraph" | "twitter"> =>
  openGraphMetadata({
    title,
    type,
    description: description ?? site.description,
    image: site.image,
    siteName: site.siteName,
    url: alternates?.canonical,
  });

/**
 * The most of a text a description repeats, in grapheme clusters: the length
 * at which X stops reading `twitter:description`. A search result or a link
 * preview cuts a shorter line itself.
 */
const DESCRIPTION_MAX_GRAPHEMES = 200;

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * The start of a body as a one-line description, with an ellipsis where it
 * was cut, or `undefined` when the body is blank. Line breaks and runs of
 * spaces collapse to one space, as a crawler shows the line.
 */
export const descriptionFromBody = (body: string): string | undefined => {
  const line = body.replaceAll(/\s+/gu, " ").trim();

  if (!line) {
    return undefined;
  }

  const segments = Array.from(
    graphemes.segment(line),
    ({ segment }) => segment
  );

  if (segments.length <= DESCRIPTION_MAX_GRAPHEMES) {
    return line;
  }

  return `${segments
    .slice(0, DESCRIPTION_MAX_GRAPHEMES - 1)
    .join("")
    .trimEnd()}…`;
};
