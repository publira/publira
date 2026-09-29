import type { EyeCatchImageVariant } from "./catalog";

/**
 * The ratio the image server crops an eye-catch to for a link preview — 1200
 * by 630, the size every card renderer states as its own (`imageproc`). The
 * other three ratios are what the site itself draws, and a card built from one
 * of those is letterboxed or cropped by whoever renders it.
 */
const OPEN_GRAPH_VARIANT_TYPE = "og";

/** One image on a card, at the path `metadataBase` resolves for a crawler. */
export interface OpenGraphImage {
  alt: string;
  height: number;
  url: string;
  width: number;
}

/**
 * The card image for a work, or `undefined` where the tenant has uploaded no
 * eye-catch — in which case the page carries a card with no picture rather than
 * one showing something that is not the work.
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
