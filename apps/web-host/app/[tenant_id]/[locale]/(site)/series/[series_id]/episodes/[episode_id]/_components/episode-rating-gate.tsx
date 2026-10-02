import type { Locale } from "@publira/i18n";
import type { ReactNode } from "react";

import { AgeRatingGate } from "#components/age-rating-gate";
import type { RestrictedAgeRating } from "#lib/age-rating";
import type {
  EpisodeAccessState,
  EpisodeDetail,
  EpisodeImageItem,
} from "#lib/catalog";
import { getReaderProvenAgeRating } from "#lib/reader-age";

import { getReaderAgeRestriction } from "../_lib/reader-age-restriction";
import { EpisodeAgeGate } from "./episode-age-gate";
import { EpisodeGateFrame } from "./episode-gate-frame";

/**
 * Both age gates in front of the episode page, in the order a reader should
 * meet them. The tenant's rule comes first: a reader it stops would otherwise
 * declare an age that opens nothing. The rating confirmation then stands in
 * front of every other reader, and in front of the whole page, not only the
 * body.
 */
export const EpisodeRatingGate = async ({
  access,
  checkoutSessionId,
  children,
  episodePublicId,
  locale,
  previewImages,
  rating,
  readingDirection,
  seriesPublicId,
  tenantId,
}: {
  /** The anonymous read's answer, which is the same for every reader. */
  access: EpisodeAccessState;
  checkoutSessionId: string;
  /**
   * The rating confirmation's `AgeRatingGateConfirmation` and the page as
   * `AgeRatingGateContent`, which the tenant's rule replaces outright.
   */
  children: ReactNode;
  episodePublicId: string;
  locale: Locale;
  /** The blurred opening pages the tenant's rule is drawn over. */
  previewImages: EpisodeImageItem[];
  rating?: RestrictedAgeRating;
  readingDirection: EpisodeDetail["readingDirection"];
  seriesPublicId: string;
  tenantId: string;
}) => {
  // The anonymous read answers `age_restricted` for everyone on a covered
  // series, so only this reader's own read may skip the confirmation.
  const ageRestriction =
    access === "age_restricted"
      ? await getReaderAgeRestriction({
          checkoutSessionId,
          episodePublicId,
          locale,
          seriesPublicId,
          tenantId,
        })
      : undefined;
  if (ageRestriction) {
    return (
      <EpisodeGateFrame
        previewImages={previewImages}
        readingDirection={readingDirection}
      >
        <EpisodeAgeGate
          episodePublicId={episodePublicId}
          hasBirthDate={ageRestriction.hasBirthDate}
          seriesPublicId={seriesPublicId}
          signedIn={ageRestriction.signedIn}
        />
      </EpisodeGateFrame>
    );
  }

  // Read only for a series that carries a rating: an unrated page has nothing
  // to ask the reader, so it never touches the session cookie.
  const provenAgeRating = rating
    ? await getReaderProvenAgeRating(tenantId)
    : undefined;

  return (
    <AgeRatingGate provenAgeRating={provenAgeRating} rating={rating}>
      {children}
    </AgeRatingGate>
  );
};
