import type { SearchParamValue } from "@publira/utils/search-params";
import { z } from "zod";

import { cursorTokenSchema } from "#lib/cursor-token";
import {
  genreFilterSchema,
  seriesFreeFilterSchema,
  seriesListQueryHref,
  seriesOrderSchema,
  seriesStatusFilterSchema,
} from "#lib/series-filters";
import type { SeriesListQuery } from "#lib/series-filters";

const seriesListSearchParamsSchema = z.object({
  free: seriesFreeFilterSchema,
  genre: genreFilterSchema,
  order: seriesOrderSchema,
  status: seriesStatusFilterSchema,
  token: cursorTokenSchema,
});

interface ParseSeriesListSearchParamsInput {
  free?: SearchParamValue;
  genre?: SearchParamValue;
  order?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface SeriesListSearchParams extends SeriesListQuery {
  /** Empty applies no genre filter. */
  genre: string;
}

export const parseSeriesListSearchParams = (
  input: ParseSeriesListSearchParamsInput
): SeriesListSearchParams => seriesListSearchParamsSchema.parse(input);

/** Whether the reader narrowed this list, which is what the empty state says. */
export const isNarrowedSeriesList = ({
  free,
  genre,
  status,
}: SeriesListSearchParams): boolean =>
  free || genre.length > 0 || status.length > 0;

export const seriesListHref = (query: SeriesListSearchParams): string =>
  seriesListQueryHref("/series", query);
