import { searchParamEnum } from "@publira/utils/search-params";
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

const rankingSearchParamsSchema = z.object({
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
  period?: SearchParamValue;
  rating?: SearchParamValue;
  token?: SearchParamValue;
}

export interface RankingSearchParams {
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  /** Empty on the first page. */
  token: string;
}

export const parseRankingSearchParams = (
  input: ParseRankingSearchParamsInput
): RankingSearchParams => rankingSearchParamsSchema.parse(input);
