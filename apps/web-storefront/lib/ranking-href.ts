import type { RankingAgeRatingName, RankingPeriodName } from "#lib/catalog";

/**
 * The chart a URL that names no period shows. It is also the one period the
 * href builder leaves out of the query string, so the tab a reader arrives on
 * has a single address rather than two that render the same page.
 */
export const DEFAULT_RANKING_PERIOD: RankingPeriodName = "daily";

/** The rating every reader may see, left out of the query the same way. */
export const DEFAULT_RANKING_AGE_RATING: RankingAgeRatingName = "all";

/**
 * A ranking page link. The token belongs to the period, rating, and genre it
 * was issued for, because the server refuses it for any other: the same
 * position names a different series there, so a tab switch leaves it out and
 * starts at the top of the chart it switches to.
 *
 * `genre` is a genre's `public_id`, left out for the tenant-wide chart.
 */
export const rankingHref = ({
  genre = "",
  period,
  rating,
  token = "",
}: {
  genre?: string;
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  token?: string;
}): string => {
  const params = new URLSearchParams();
  if (genre) {
    params.set("genre", genre);
  }
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
