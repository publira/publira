import { imageServerLoader } from "@publira/utils/image-loader";

/**
 * The widths a page is offered at, whatever its stored size. image-server
 * caches a converted page under a key that includes `w`, so a ladder shared by
 * every page, rather than widths worked out from each reader's screen, is what
 * keeps the renditions cached per page to a handful.
 */
const RENDITION_WIDTHS = [480, 720, 1080, 1440, 2160, 2880, 3840] as const;

const RENDITION_WIDTH_QUERY_PARAM = "w";

/** `url` asked for at `width`, as image-server resizes a page. */
export const atRenditionWidth = (url: string, width: number): string =>
  imageServerLoader({ src: url, width });

/**
 * The `srcset` of a page stored at `imageUrl`, or `undefined` for a URL
 * image-server does not resize. A page whose stored width is known is offered
 * no wider than that: `fit=scale-down` would answer a wider rendition with the
 * stored size anyway, under a cache entry of its own. Its stored width is
 * always the top candidate, so a reader on a wide display still gets every
 * pixel the page has.
 */
export const pageSrcset = (
  imageUrl: string,
  storedWidth: number | undefined
): string | undefined => {
  const widths =
    storedWidth === undefined
      ? RENDITION_WIDTHS
      : [
          ...RENDITION_WIDTHS.filter((width) => width < storedWidth),
          storedWidth,
        ];
  const candidates = widths.map((width) => ({
    url: atRenditionWidth(imageUrl, width),
    width,
  }));
  if (candidates.some(({ url }) => url === imageUrl)) {
    return undefined;
  }

  return candidates.map(({ url, width }) => `${url} ${width}w`).join(", ");
};

/**
 * The width `url` asks image-server for, or `undefined` for a URL that asks
 * for none, as a page's own `src` does.
 */
export const renditionWidthOf = (url: string): number | undefined => {
  let value: string | null;
  try {
    value = new URL(
      url,
      globalThis.location?.href ?? "http://localhost"
    ).searchParams.get(RENDITION_WIDTH_QUERY_PARAM);
  } catch {
    return undefined;
  }
  const width = Number(value);

  return value !== null && Number.isInteger(width) && width > 0
    ? width
    : undefined;
};
