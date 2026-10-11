import { ageRatingSatisfiedBy, ageVerificationCovers } from "#lib/age-rating";
import type { RestrictedAgeRating } from "#lib/age-rating";
import type { RankingAgeRatingName } from "#lib/catalog";
import type { TenantAgeVerification } from "#lib/tenant";

import { RANKING_AGE_RATINGS } from "./search-params";

/**
 * The ratings whose ranking this reader may open: all-ages always, a rating
 * the tenant's rule does not cover behind the browser's own confirmation, and
 * a covered one only once the reader's birth date clears it — the same readers
 * the server answers.
 */
export const rankingAgeRatingsFor = (
  rule: TenantAgeVerification,
  provenAgeRating?: RestrictedAgeRating
): RankingAgeRatingName[] =>
  RANKING_AGE_RATINGS.filter(
    (rating) =>
      rating === "all" ||
      !ageVerificationCovers(rule, rating) ||
      ageRatingSatisfiedBy(rating, provenAgeRating)
  );
