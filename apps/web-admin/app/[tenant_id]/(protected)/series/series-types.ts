import type { EyeCatchVariantItem } from "#components/eye-catch/types";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";
import type { SurfaceAvailabilityValue } from "#lib/surface-availability";

export type SeriesEyeCatchVariantItem = EyeCatchVariantItem;

/**
 * One credit line of a series: who, and in what role. The pair is the identity
 * of a credit, which is why one person can appear twice under two roles and
 * never twice under the same one.
 */
export interface SeriesCreatorCredit {
  creatorId: string;
  roleId: string;
  /** Basis points: 10000 is 100%. */
  shareBps: number;
}

export interface SeriesListItem {
  id: string;
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  publishedAt: string;
  labelId: string;
  labelName: string;
  /** In role priority order, then the order the editor gave within a role. */
  creatorCredits: SeriesCreatorCredit[];
  isPublished: boolean;
  status: SeriesStatusValue;
  scheduleWeekdays: number[];
  ageRating: SeriesAgeRatingValue;
  genreIds: string[];
  tagNames: string[];
  eyeCatchImageVariants: SeriesEyeCatchVariantItem[];
  eyeCatchImageUpdatedAt: string;
  availability: SurfaceAvailabilityValue;
}

export type SeriesMutationMode = "create" | "update";

export type SeriesActionState =
  | {
      ok: false;
      message: string;
      mode: SeriesMutationMode;
    }
  | {
      ok: true;
      message: string;
      mode: SeriesMutationMode;
      series: SeriesListItem;
    }
  | null;
