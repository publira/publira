import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import type { RankingAgeRatingName, RankingPeriodName } from "#lib/catalog";
import { cursorTokenSchema } from "#lib/cursor-token";

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
 * The chart a URL that names no period shows. It is also the one period the
 * href builder leaves out of the query string, so the tab a reader arrives on
 * has a single address rather than two that render the same page.
 */
export const DEFAULT_RANKING_PERIOD: RankingPeriodName = "daily";

/** The rating every reader may see, left out of the query the same way. */
export const DEFAULT_RANKING_AGE_RATING: RankingAgeRatingName = "all";

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

/**
 * A ranking page link. The token belongs to the period and rating it was
 * issued for, because the server refuses it for any other: the same position
 * names a different series there, so a tab switch leaves it out and starts at
 * the top of the chart it switches to.
 */
export const rankingHref = ({
  period,
  rating,
  token = "",
}: {
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  token?: string;
}): string => {
  const params = new URLSearchParams();
  if (period !== DEFAULT_RANKING_PERIOD) {
    params.set("period", period);
  }
  if (rating !== DEFAULT_RANKING_AGE_RATING) {
    params.set("rating", rating);
  }
  if (token) {
    params.set("token", token);
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `/ranking?${serialized}` : "/ranking";
};
