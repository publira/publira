import { Badge } from "@publira/ui-components/badge";
import type { BadgeTone } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import type { RestrictedAgeRating } from "#lib/age-rating";
import type { HostMessageKey } from "#lib/locale";

import { Message } from "./message";

const AGE_RATING_COPY = {
  r15: "host.common.age_rating_r15",
  r18: "host.common.age_rating_r18",
} as const satisfies Record<RestrictedAgeRating, HostMessageKey>;

/**
 * What each rating looks like at a glance: R15 is a warning a reader can
 * still clear with a confirmation, and R18 is the stronger stop.
 */
const AGE_RATING_TONES = {
  r15: "warning",
  r18: "destructive",
} as const satisfies Record<RestrictedAgeRating, BadgeTone>;

/**
 * The mark a rated series carries on a card and on its own page. All-ages
 * series render nothing: a badge that said "all ages" on every cover would
 * stop meaning the ones that are not.
 */
export const AgeRatingBadge = ({
  rating,
}: {
  rating?: RestrictedAgeRating;
}) => {
  if (!rating) {
    return null;
  }

  return (
    <Badge tone={AGE_RATING_TONES[rating]}>
      <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
        <Message message={AGE_RATING_COPY[rating]} />
      </Suspense>
    </Badge>
  );
};
