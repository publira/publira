import { Badge } from "@publira/ui-components/badge";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";

import type { RestrictedAgeRating } from "#lib/age-rating";

import { Message } from "./message";

/**
 * The mark a rated series carries on a card and on its own page. All-ages
 * series render nothing: a badge that said "all ages" on every cover would
 * stop meaning the ones that are not.
 *
 * What each rating looks like at a glance: R15 is a warning a reader can
 * still clear with a confirmation, and R18 is the stronger stop.
 */
export const AgeRatingBadge = ({
  rating,
}: {
  rating?: RestrictedAgeRating;
}) => {
  switch (rating) {
    case "r15": {
      return (
        <Badge tone="warning">
          <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
            <Message message="host.common.age_rating_r15" />
          </Suspense>
        </Badge>
      );
    }
    case "r18": {
      return (
        <Badge tone="destructive">
          <Suspense fallback={<SkeletonLine className="h-4 w-8" />}>
            <Message message="host.common.age_rating_r18" />
          </Suspense>
        </Badge>
      );
    }
    default: {
      return null;
    }
  }
};
