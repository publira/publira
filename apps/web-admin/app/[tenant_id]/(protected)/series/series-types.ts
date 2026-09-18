import type { EyeCatchVariantItem } from "#components/eye-catch/types";
import type {
  SeriesAgeRatingValue,
  SeriesStatusValue,
} from "#lib/series-classification";

export type SeriesEyeCatchVariantItem = EyeCatchVariantItem;

/**
 * One credit line of a series: who, and in what role. The pair is the identity
 * of a credit, which is why one person can appear twice under two roles and
 * never twice under the same one.
 */
export interface SeriesCreatorCredit {
  creatorPublicId: string;
  rolePublicId: string;
  /** Basis points: 10000 is 100%. */
  shareBps: number;
}

export interface SeriesListItem {
  publicId: string;
  title: string;
  synopsis: string;
  readingPeriodHours: number;
  publishedAt: string;
  labelPublicId: string;
  labelName: string;
  /** In role priority order, then the order the editor gave within a role. */
  creatorCredits: SeriesCreatorCredit[];
  isPublished: boolean;
  status: SeriesStatusValue;
  scheduleWeekdays: number[];
  ageRating: SeriesAgeRatingValue;
  genrePublicIds: string[];
  tagNames: string[];
  eyeCatchImageVariants: SeriesEyeCatchVariantItem[];
  eyeCatchImageUpdatedAt: string;
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
