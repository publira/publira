import { LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import { Suspense } from "react";
import type { ReactNode } from "react";

import { LocaleLink } from "#components/locale-link";
import { Message } from "#components/message";
import type { RankingAgeRatingName, RankingPeriodName } from "#lib/catalog";

import { rankingHref } from "../_lib/search-params";

/**
 * What stands where a rated ranking would be when the tenant makes a reader
 * prove an age for that rating and they have not. Its three states are the
 * episode's: the session, the birth date, or the years themselves.
 */
export const RankingAgeGate = ({
  hasBirthDate,
  period,
  rating,
  signedIn,
}: {
  /** Whether the reader has already given a date, which they cannot rewrite. */
  hasBirthDate: boolean;
  period: RankingPeriodName;
  rating: RankingAgeRatingName;
  signedIn: boolean;
}) => {
  let closedBecause: ReactNode;
  let ageAction: ReactNode = null;
  if (!signedIn) {
    closedBecause = (
      <Message message="host.ranking.age_gate.guest_description" />
    );
    ageAction = (
      <LinkButton
        render={
          <LocaleLink
            href={`/login?returnTo=${encodeURIComponent(rankingHref({ period, rating }))}`}
          />
        }
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-20" />}>
          <Message message="host.ranking.age_gate.login" />
        </Suspense>
      </LinkButton>
    );
  } else if (hasBirthDate) {
    closedBecause = (
      <Message message="host.ranking.age_gate.too_young_description" />
    );
  } else {
    closedBecause = (
      <Message message="host.ranking.age_gate.no_birth_date_description" />
    );
    ageAction = (
      <LinkButton
        render={<LocaleLink href="/settings" />}
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="host.ranking.age_gate.add_birth_date" />
        </Suspense>
      </LinkButton>
    );
  }

  return (
    <EmptyState>
      <EmptyStateHeading>
        <EmptyStateTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.ranking.age_gate.title" />
          </Suspense>
        </EmptyStateTitle>
        <EmptyStateDescription>
          <Suspense fallback={<SkeletonLine className="h-4 w-full max-w-md" />}>
            {closedBecause}
          </Suspense>
        </EmptyStateDescription>
      </EmptyStateHeading>
      <EmptyStateActions>
        <div className="flex flex-wrap justify-center gap-3">
          {ageAction}
          <LinkButton
            render={
              <LocaleLink href={rankingHref({ period, rating: "all" })} />
            }
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
              <Message message="host.ranking.back_to_all_ages" />
            </Suspense>
          </LinkButton>
        </div>
      </EmptyStateActions>
    </EmptyState>
  );
};
