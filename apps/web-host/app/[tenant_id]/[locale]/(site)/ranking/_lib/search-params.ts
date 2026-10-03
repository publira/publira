import {
  searchParamEnum,
  searchParamString,
} from "@publira/utils/search-params";
import { z } from "zod";

import type { RankingAgeRatingName, RankingPeriodName } from "#lib/catalog";
import { cursorTokenSchema } from "#lib/cursor-token";
import {
  DEFAULT_RANKING_AGE_RATING,
  DEFAULT_RANKING_PERIOD,
} from "#lib/ranking-href";

const rankingPeriods = [
  "daily",
  "weekly",
] as const satisfies readonly RankingPeriodName[];

/** Every rating ranked on its own, in the order a reader is shown them. */
export const RANKING_AGE_RATINGS = [
  "all",
  "r15",
  "r18",
] as const satisfies readonly RankingAgeRatingName[];

/**
 * The genre a URL names, kept as written: a value that names no genre of the
 * tenant is a page that does not exist, which only the genre list can tell, so
 * this boundary must not turn it into the tenant-wide chart. Only an absent or
 * empty value is that chart.
 *
 * So an over-long value is cut down rather than dropped, and a key repeated
 * with different values, which `searchParamString` would read as no value at
 * all, is joined into one string that no `public_id` can equal.
 */
const rankingGenreSchema = z.preprocess(
  (value) =>
    Array.isArray(value) && value.some((entry) => entry !== value[0])
      ? value.join(",")
      : value,
  searchParamString({ fallback: "", truncate: true })
);

const rankingSearchParamsSchema = z.object({
  genre: rankingGenreSchema,
  period: searchParamEnum(rankingPeriods, {
    fallback: DEFAULT_RANKING_PERIOD,
  }),
  rating: searchParamEnum(RANKING_AGE_RATINGS, {
    fallback: DEFAULT_RANKING_AGE_RATING,
  }),
  token: cursorTokenSchema,
});

type SearchParamValue = string | string[] | undefined;

interface ParseRankingSearchParamsInput {
  genre?: SearchParamValue;
  period?: SearchParamValue;
  rating?: SearchParamValue;
  token?: SearchParamValue;
}

export interface RankingSearchParams {
  /** A genre's `public_id`, empty for the tenant-wide chart. */
  genre: string;
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  /** Empty on the first page. */
  token: string;
}

export const parseRankingSearchParams = (
  input: ParseRankingSearchParamsInput
): RankingSearchParams => rankingSearchParamsSchema.parse(input);

/**
 * The genre a chart of `rating` can carry. A genre is ranked among all-ages
 * series alone, so every rated chart is the tenant-wide one, and a URL naming
 * a genre beside a rating is a chart that does not exist.
 */
export const rankingGenreFor = (
  rating: RankingAgeRatingName,
  genre: string
): string => (rating === "all" ? genre : "");
