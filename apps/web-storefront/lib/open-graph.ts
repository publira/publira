import type { Metadata } from "next";

import type { EyeCatchImageVariant } from "./catalog";

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
  height: OPEN_GRAPH_CARD_HEIGHT,
  url,
  width: OPEN_GRAPH_CARD_WIDTH,
});

/** The artwork one card could be built from, and the text it is described by. */
interface OpenGraphSource {
  alt: string;
  variants: EyeCatchImageVariant[] | undefined;
}

/**
 * The card image for a series: its uploaded eye-catch where it has an `og`
 * variant, untouched, and the card the storefront draws at `cardUrl` where it
 * has none.
 */
export const resolveSeriesOpenGraphImage = (
  series: OpenGraphSource,
  cardUrl: string
): OpenGraphImage =>
  resolveOpenGraphImage(series.variants, series.alt) ??
  openGraphCardImage(cardUrl, series.alt);

/**
 * The card image for an episode: its own eye-catch where it has an `og`
 * variant, its series' where it does not, and the card the storefront draws
 * at `cardUrl` where neither has one — so an episode without artwork still
 * unfurls with the work's picture before it falls back on a drawn one.
 */
export const resolveEpisodeOpenGraphImage = (
  episode: OpenGraphSource,
  series: OpenGraphSource,
  cardUrl: string
): OpenGraphImage =>
  resolveOpenGraphImage(episode.variants, episode.alt) ??
  resolveOpenGraphImage(series.variants, series.alt) ??
  openGraphCardImage(cardUrl, episode.alt);

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
  openGraph: { description, images: image, siteName, title, type, url },
  twitter: {
    card: "summary_large_image",
    description,
    images: image,
    title,
  },
});
