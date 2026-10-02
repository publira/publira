import { SeriesAgeRating } from "@publira/api-client/public/types";
import { plainDateOrNull } from "@publira/utils";
import type { Metadata } from "next";

import type { TenantAgeVerification } from "./tenant";

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
 * Whether a rating the reader already carries — confirmed in this browser, or
 * proven by their birth date — is enough for the one a series does. `r18`
 * covers `r15` as well; `r15` does not open an `r18` series.
 */
export const ageRatingSatisfiedBy = (
  required?: RestrictedAgeRating,
  held?: RestrictedAgeRating
): boolean => {
  if (!required) {
    return true;
  }
  if (!held) {
    return false;
  }
  if (required === "r15") {
    return true;
  }
  return held === "r18";
};

/**
 * Whether the tenant's rule makes a reader prove an age for `rating`, as the
 * server's age gate decides it. A rating the rule does not cover is left to
 * the browser's own confirmation.
 */
export const ageVerificationCovers = (
  rule: TenantAgeVerification,
  rating?: RestrictedAgeRating
): boolean => {
  if (rating === "r18") {
    return rule !== "none";
  }
  if (rating === "r15") {
    return rule === "r15_and_r18";
  }
  return false;
};

/** Each rating's own number, so it and the age it demands cannot drift apart. */
const MINIMUM_AGE = { r15: 15, r18: 18 } as const satisfies Record<
  RestrictedAgeRating,
  number
>;

/**
 * The highest rating a reader born on `birthDate` carries on `today`, and
 * `undefined` when they are younger than either asks for. `today` is the
 * tenant's calendar day, as on the server (`age_gate.go`), so a birthday
 * arrives when the tenant's calendar says it does.
 */
export const provenAgeRating = (
  birthDate: string,
  today: Temporal.PlainDate
): RestrictedAgeRating | undefined => {
  const born = plainDateOrNull(birthDate);
  if (!born) {
    return undefined;
  }

  const { years } = today.since(born, { largestUnit: "year" });
  if (years >= MINIMUM_AGE.r18) {
    return "r18";
  }
  if (years >= MINIMUM_AGE.r15) {
    return "r15";
  }
  return undefined;
};

/** Spread onto a mapped record so all-ages series do not carry a blank field. */
export const withRestrictedAgeRating = <T extends object>(
  value: T,
  rating?: SeriesAgeRating | number
): T & { ageRating?: RestrictedAgeRating } => {
  const ageRating = toRestrictedAgeRating(rating);
  return ageRating ? { ...value, ageRating } : value;
};

/**
 * The `<meta name="rating" content="adult">` a rated work's own pages carry,
 * which is how Google asks a site to mark the pages SafeSearch should filter.
 *
 * Only the series page and its episode pages spread this. A page that lists
 * works mixes ratings, and labelling it would hand the classification back to
 * the whole storefront — the very thing marking page by page keeps confined to
 * the rated works.
 */
export const adultContentMetadata = (
  rating?: RestrictedAgeRating
): Pick<Metadata, "other"> => (rating ? { other: { rating: "adult" } } : {});
