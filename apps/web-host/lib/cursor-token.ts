import { z } from "zod";

/**
 * A cursor token is opaque to the client (`proto/README.md`), so the only thing
 * this boundary can check is its shape: unpadded base64url, within a length the
 * server would accept. Anything else — a hand-edited URL, a repeated parameter
 * — normalizes to "no token" and shows the first page, which is a meaningful
 * default view, instead of being forwarded for the server to reject.
 *
 * Every list on this site takes its token from `searchParams`, so the schema
 * lives here rather than being copied into each page's `_lib/search-params.ts`.
 */
const maxTokenLength = 512;
const tokenPattern = /^[A-Za-z0-9_-]+$/u;

/**
 * Length is part of the alphabet check, not a separate bound. Unpadded base64url
 * encodes 3 bytes per 4 characters and its tail is 2 or 3 characters, so a
 * length that leaves a remainder of 1 cannot decode — `"a"` is in the alphabet
 * but is not a token any encoder produces.
 */
const isBase64UrlShaped = (value: string): boolean =>
  value.length <= maxTokenLength &&
  value.length % 4 !== 1 &&
  tokenPattern.test(value);

export const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z.string().transform((value) => (isBase64UrlShaped(value) ? value : ""))
);

/**
 * Builds a page link for a list route. An empty token drops the parameter
 * entirely, i.e. back to page 1. `pathname` stays absolute, because a relative
 * `.` resolves against `/series` as a file rather than a directory and would
 * land on the site root.
 */
export const cursorPageHref = (pathname: string, token: string): string =>
  token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
