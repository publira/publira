import { z } from "zod";

import { cursorPageHref, cursorTokenSchema } from "#lib/cursor-token";

const seriesListSearchParamsSchema = z.object({
  token: cursorTokenSchema,
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

export const seriesListHref = (token: string): string =>
  cursorPageHref("/series", token);
