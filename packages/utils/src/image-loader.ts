/**
 * `next/image` loader for the server's image routes (`/images/...`).
 *
 * The image routes proxy through Manael, which reads `w` / `h` / `fit` / `q`
 * off the query string and picks WebP or AVIF from the request's `Accept`.
 * Handing it the width `next/image` already computed is what keeps the browser
 * from downloading a full-size original, and what keeps `/_next/image` — which
 * would re-encode the converted bytes a second time — out of the path.
 *
 * The routes are reached on the page's own host (`/images/...`), or on a
 * tenant's image host, for which the public API answers absolute URLs
 * (`https://images.example.com/images/...`). Both are resized alike.
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

/**
 * `src` as a URL on the image routes, or `undefined` for anything else.
 *
 * A host-relative `src` is parsed against a placeholder origin, which never
 * reaches the result: {@link imageServerLoader} hands such a `src` back as a
 * path, on whatever host the page is.
 */
const parseImageServerUrl = (
  src: string,
  hostRelative: boolean
): URL | undefined => {
  let url: URL;

  try {
    url = hostRelative ? new URL(src, "http://localhost") : new URL(src);
  } catch {
    return undefined;
  }

  return url.pathname.startsWith(IMAGE_SERVER_PATH_PREFIX) ? url : undefined;
};

export const imageServerLoader = ({
  quality,
  src,
  width,
}: ImageServerLoaderParams): string => {
  const hostRelative = src.startsWith("/") && !src.startsWith("//");
  const url = parseImageServerUrl(src, hostRelative);

  // Object URLs for a not-yet-uploaded file, and anything served by something
  // other than the image routes, have no transform to ask for.
  if (!url) {
    return src;
  }

  url.searchParams.set("w", String(width));
  url.searchParams.set("fit", RESIZE_FIT);

  // Manael tunes quality per format (WebP 90, AVIF 60), and `next/image` hands
  // the loader `undefined` when there is no `quality` prop, so leaving `q` out
  // is what lets those defaults apply. A call site that does ask for a quality
  // has to list that value in the app's `images.qualities` as well: the default
  // is `[75]`, and a value outside it warns in development (the value still
  // reaches the loader, this being a custom one).
  if (quality !== undefined) {
    url.searchParams.set("q", String(quality));
  }

  return hostRelative ? `${url.pathname}${url.search}` : url.href;
};
