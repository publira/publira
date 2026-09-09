import { searchParamEnum } from "@publira/utils/search-params";
import { z } from "zod";

import type { RankingPeriodName } from "#lib/catalog";
import { cursorTokenSchema } from "#lib/cursor-token";

const rankingPeriods = [
  "daily",
  "weekly",
] as const satisfies readonly RankingPeriodName[];

/**
 * The chart a URL that names no period shows. It is also the one period the
 * href builder leaves out of the query string, so the tab a reader arrives on
 * has a single address rather than two that render the same page.
 */
export const DEFAULT_RANKING_PERIOD: RankingPeriodName = "daily";

const rankingSearchParamsSchema = z.object({
  period: searchParamEnum(rankingPeriods, {
    fallback: DEFAULT_RANKING_PERIOD,
  }),
  token: cursorTokenSchema,
});

interface ParseRankingSearchParamsInput {
  period?: string | string[] | undefined;
  token?: string | string[] | undefined;
}

export interface RankingSearchParams {
  period: RankingPeriodName;
  /** Empty on the first page. */
  token: string;
}

export const parseRankingSearchParams = (
  input: ParseRankingSearchParamsInput
): RankingSearchParams => rankingSearchParamsSchema.parse(input);

/**
 * A ranking page link. The token is dropped when the period changes, because
 * the server refuses a token issued for the other period: the same position
 * names a different series there, so a tab switch starts at the top of the
 * chart it switches to.
 */
export const rankingHref = (period: RankingPeriodName, token = ""): string => {
  const params = new URLSearchParams();
  if (period !== DEFAULT_RANKING_PERIOD) {
    params.set("period", period);
  }
  if (token) {
    params.set("token", token);
  }

  const serialized = params.toString();
  return serialized.length > 0 ? `/ranking?${serialized}` : "/ranking";
};
