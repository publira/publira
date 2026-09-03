/**
 * `next/image` loader for the image-server (`/images/...`).
 *
 * The image-server proxies through Manael, which reads `w` / `h` / `fit` / `q`
 * off the query string and picks WebP or AVIF from the request's `Accept`.
 * Handing it the width `next/image` already computed is what keeps the browser
 * from downloading a full-size original, and what keeps `/_next/image` — which
 * would re-encode the converted bytes a second time — out of the path.
 */

export interface ImageServerLoaderParams {
  src: string;
  width: number;
  quality?: number;
}

const IMAGE_SERVER_PATH_PREFIX = "/images/";

/**
 * `scale-down` rather than Manael's default: `next/image` asks for every width
 * in `deviceSizes`, up to 3840px, so the default (`contain`, which enlarges)
 * would blow a 512px avatar up to a multi-megabyte 3840px encode. `scale-down`
 * caps the result at the original's size.
 */
const RESIZE_FIT = "scale-down";

export const imageServerLoader = ({
  quality,
  src,
  width,
}: ImageServerLoaderParams): string => {
  // Object URLs for a not-yet-uploaded file, and anything served by something
  // other than the image-server, have no transform to ask for.
  if (!src.startsWith(IMAGE_SERVER_PATH_PREFIX)) {
    return src;
  }

  const queryIndex = src.indexOf("?");
  const pathname = queryIndex === -1 ? src : src.slice(0, queryIndex);
  const params = new URLSearchParams(
    queryIndex === -1 ? "" : src.slice(queryIndex + 1)
  );

  params.set("w", String(width));
  params.set("fit", RESIZE_FIT);
  // Manael tunes quality per format (WebP 90, AVIF 60), and `next/image` hands
  // the loader `undefined` when there is no `quality` prop, so leaving `q` out
  // is what lets those defaults apply. A call site that does ask for a quality
  // has to list that value in the app's `images.qualities` as well: the default
  // is `[75]`, and a value outside it warns in development (the value still
  // reaches the loader, this being a custom one).
  if (quality !== undefined) {
    params.set("q", String(quality));
  }

  return `${pathname}?${params.toString()}`;
};
