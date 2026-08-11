import { z } from "zod";

import { buildQueryString } from "#lib/query-string";

type QueryParamValue = string | string[] | undefined;

interface ParseSeriesSearchParamsInput {
  token?: QueryParamValue;
}

export interface SeriesSearchParams {
  token: string;
}

const seriesSearchParamsSchema = z.object({
  // Cursor tokens are opaque, so the only check the UI can make is that the
  // value arrived as a single string. Anything else falls back to page one.
  token: z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : ""),
    z.string()
  ),
});

export const parseSeriesSearchParams = (
  input: ParseSeriesSearchParamsInput
): SeriesSearchParams => seriesSearchParamsSchema.parse(input);

/**
 * Query-only href, so a page link stays on the current tenant's `/series`
 * route without the caller having to know the tenant segment.
 */
export const buildSeriesPageHref = ({ token }: SeriesSearchParams): string =>
  buildQueryString({ token }) || "?";
