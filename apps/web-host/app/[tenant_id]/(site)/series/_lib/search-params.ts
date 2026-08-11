import { z } from "zod";

/**
 * A cursor token is opaque to the client (`proto/README.md`), so the only thing
 * this boundary can check is its shape: unpadded base64url, within a length the
 * server would accept. Anything else — a hand-edited URL, a repeated parameter
 * — normalizes to "no token" and shows the first page, which is a meaningful
 * default view, instead of being forwarded for the server to reject.
 */
const maxTokenLength = 512;
const tokenPattern = /^[A-Za-z0-9_-]+$/u;

const tokenSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : ""),
  z
    .string()
    .transform((value) =>
      value.length <= maxTokenLength && tokenPattern.test(value) ? value : ""
    )
);

const seriesListSearchParamsSchema = z.object({
  token: tokenSchema,
});

interface ParseSeriesListSearchParamsInput {
  token?: string | string[] | undefined;
}

export interface SeriesListSearchParams {
  /** Empty on the first page. */
  token: string;
}

export const parseSeriesListSearchParams = (
  input: ParseSeriesListSearchParamsInput
): SeriesListSearchParams => seriesListSearchParamsSchema.parse(input);

/**
 * Absolute, because a relative `.` resolves against `/series` as a file rather
 * than a directory and would land on the site root. An empty token drops the
 * parameter entirely, i.e. back to page 1.
 */
export const seriesListHref = (token: string): string =>
  token ? `/series?token=${encodeURIComponent(token)}` : "/series";
