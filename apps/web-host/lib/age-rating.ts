import { SeriesAgeRating } from "@publira/api-client/public/types";

/**
 * Ratings a reader has to confirm before the pages open. `all` and an
 * unspecified rating are not this: they carry no badge and no interstitial.
 */
export const RESTRICTED_AGE_RATINGS = ["r15", "r18"] as const;

export type RestrictedAgeRating = (typeof RESTRICTED_AGE_RATINGS)[number];

/**
 * Map the RPC enum onto the rating a badge and a gate can branch on.
 * Unspecified and `all` become `undefined`, so a missing field cannot close a
 * series a tenant never rated.
 */
export const toRestrictedAgeRating = (
  rating?: SeriesAgeRating | number
): RestrictedAgeRating | undefined => {
  if (rating === SeriesAgeRating.R15) {
    return "r15";
  }
  if (rating === SeriesAgeRating.R18) {
    return "r18";
  }
  return undefined;
};

/**
 * Whether a stored confirmation is enough for this rating. Confirming `r18`
 * covers `r15` as well; confirming `r15` does not open an `r18` series.
 */
export const ageRatingMeetsConfirmation = (
  required?: RestrictedAgeRating,
  confirmed?: RestrictedAgeRating
): boolean => {
  if (!required) {
    return true;
  }
  if (!confirmed) {
    return false;
  }
  if (required === "r15") {
    return true;
  }
  return confirmed === "r18";
};

/** Spread onto a mapped record so all-ages series do not carry a blank field. */
export const withRestrictedAgeRating = <T extends object>(
  value: T,
  rating?: SeriesAgeRating | number
): T & { ageRating?: RestrictedAgeRating } => {
  const ageRating = toRestrictedAgeRating(rating);
  return ageRating ? { ...value, ageRating } : value;
};
