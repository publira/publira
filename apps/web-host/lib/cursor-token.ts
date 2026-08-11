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

export const cursorTokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z
    .string()
    .transform((value) =>
      value.length <= maxTokenLength && tokenPattern.test(value) ? value : ""
    )
);

/**
 * Builds a page link for a list route. An empty token drops the parameter
 * entirely, i.e. back to page 1. `pathname` stays absolute, because a relative
 * `.` resolves against `/series` as a file rather than a directory and would
 * land on the site root.
 */
export const cursorPageHref = (pathname: string, token: string): string =>
  token ? `${pathname}?token=${encodeURIComponent(token)}` : pathname;
