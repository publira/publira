"use client";

import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { ageRatingMeetsConfirmation } from "#lib/age-rating";
import type { RestrictedAgeRating } from "#lib/age-rating";
import { useConfirmedAgeRating } from "#lib/age-rating-confirmation";
import { useTenantId } from "#lib/use-tenant-id";

/**
 * Hides a rated series until this browser has confirmed that rating.
 *
 * Home modules and search render every row the cached read returned, and this
 * is what drops the rated ones for a first-time visitor — a cookie would fork
 * the cache, and filtering on the server would too. The first paint matches
 * SSR: unconfirmed, so a rated cover never flashes on.
 */
export const AgeRatedVisibility = ({
  children,
  rating,
}: {
  children: ReactNode;
  rating?: RestrictedAgeRating;
}) => {
  const tenantId = useTenantId();
  const confirmed = useConfirmedAgeRating(tenantId);

  if (!ageRatingMeetsConfirmation(rating, confirmed)) {
    return null;
  }

  return children;
};

/**
 * Search keeps every hit in the cached page, so a first-time visitor can land
 * on an empty-looking list. This sentence is what says the missing rows are
 * rated, not missing.
 */
export const AgeRatedHiddenNotice = ({
  ratings,
}: {
  ratings: (RestrictedAgeRating | undefined)[];
}) => {
  const tenantId = useTenantId();
  const confirmed = useConfirmedAgeRating(tenantId);
  const hidden = ratings.some(
    (rating) => !ageRatingMeetsConfirmation(rating, confirmed)
  );

  if (!hidden) {
    return null;
  }

  return (
    <p className="text-sm text-muted-foreground">
      <Suspense fallback={<SkeletonLine className="h-4 w-72" />}>
        <ClientMessage message="host.search.age_rated_hidden" />
      </Suspense>
    </p>
  );
};
