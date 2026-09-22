import type { Locale } from "@publira/i18n";
import type { ReactNode } from "react";

import { AgeRatingGate } from "#components/age-rating-gate";
import type { RestrictedAgeRating } from "#lib/age-rating";
import type { EpisodeAccessState } from "#lib/catalog";
import { getReaderProvenAgeRating } from "#lib/reader-age";

import { getReaderAgeRestriction } from "../_lib/reader-age-restriction";
import { EpisodeAgeGate } from "./episode-age-gate";

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
  rating,
  seriesPublicId,
  seriesTitle,
  tenantId,
}: {
  /** The anonymous read's answer, which is the same for every reader. */
  access: EpisodeAccessState;
  checkoutSessionId: string;
  children: ReactNode;
  episodePublicId: string;
  locale: Locale;
  rating?: RestrictedAgeRating;
  seriesPublicId: string;
  seriesTitle: string;
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
      <div className="mx-auto grid max-w-6xl px-6 py-10">
        <EpisodeAgeGate
          episodePublicId={episodePublicId}
          hasBirthDate={ageRestriction.hasBirthDate}
          seriesPublicId={seriesPublicId}
          signedIn={ageRestriction.signedIn}
        />
      </div>
    );
  }

  // Read only for a series that carries a rating: an unrated page has nothing
  // to ask the reader, so it never touches the session cookie.
  const provenAgeRating = rating
    ? await getReaderProvenAgeRating(tenantId)
    : undefined;

  return (
    <AgeRatingGate
      backHref={`/series/${seriesPublicId}`}
      backMessage="host.episode.to_series_detail"
      provenAgeRating={provenAgeRating}
      rating={rating}
      seriesTitle={seriesTitle}
    >
      {children}
    </AgeRatingGate>
  );
};
