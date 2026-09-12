import type { SearchParamValue } from "@publira/utils/search-params";
import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import {
  SERIES_AGE_RATING_VALUES,
  SERIES_STATUS_VALUES,
} from "#lib/series-classification";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

interface ParseSeriesFiltersInput {
  age_rating?: SearchParamValue;
  status?: SearchParamValue;
  token?: SearchParamValue;
}

export interface SeriesFilters {
  ageRating: SeriesAgeRatingValue | "";
  status: SeriesStatusValue | "";
  token: string;
}

/**
 * Every filter falls back to the unfiltered list. A malformed URL must not
 * strand an editor on a 404 when the default series list remains useful.
 */
const seriesFiltersSchema = z.object({
  age_rating: searchParamEnum(SERIES_AGE_RATING_VALUES, { fallback: "" }),
  status: searchParamEnum(SERIES_STATUS_VALUES, { fallback: "" }),
  token: searchParamString({ fallback: "" }),
});

export const parseSeriesFilters = (
  input: ParseSeriesFiltersInput
): SeriesFilters => {
  const parsed = seriesFiltersSchema.parse(input);
  return {
    ageRating: parsed.age_rating,
    status: parsed.status,
    token: parsed.token,
  };
};
