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

import { episodeLoginHref } from "../_lib/access-gate";

/**
 * What stands where the pages would be when the tenant makes a reader prove an
 * age for this series and they have not. Its three states are the three things
 * that can be missing: the session, the birth date, or the years themselves.
 */
export const EpisodeAgeGate = ({
  episodePublicId,
  hasBirthDate,
  seriesPublicId,
  signedIn,
}: {
  episodePublicId: string;
  /** Whether the reader has already given a date, which they cannot rewrite. */
  hasBirthDate: boolean;
  seriesPublicId: string;
  signedIn: boolean;
}) => {
  // Each branch writes its own key out, the way the access gate beside it does:
  // a key chosen elsewhere and handed over as a value is one that nothing
  // reading this file can account for.
  let closedBecause: ReactNode;
  let ageAction: ReactNode = null;
  if (!signedIn) {
    closedBecause = (
      <Message message="host.episode.age_gate.guest_description" />
    );
    ageAction = (
      <LinkButton
        render={
          <LocaleLink
            href={episodeLoginHref(seriesPublicId, episodePublicId)}
          />
        }
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
          <Message message="host.episode.gate.login" />
        </Suspense>
      </LinkButton>
    );
  } else if (hasBirthDate) {
    closedBecause = (
      <Message message="host.episode.age_gate.too_young_description" />
    );
  } else {
    closedBecause = (
      <Message message="host.episode.age_gate.no_birth_date_description" />
    );
    ageAction = (
      <LinkButton
        render={<LocaleLink href="/settings" />}
        size="lg"
        variant="secondary"
      >
        <Suspense fallback={<SkeletonLine className="h-4 w-40" />}>
          <Message message="host.episode.age_gate.add_birth_date" />
        </Suspense>
      </LinkButton>
    );
  }

  return (
    <EmptyState>
      <EmptyStateHeading>
        <EmptyStateTitle>
          <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
            <Message message="host.episode.age_gate.title" />
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
            render={<LocaleLink href={`/series/${seriesPublicId}`} />}
            variant="outline"
          >
            <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
              <Message message="host.episode.to_series_detail" />
            </Suspense>
          </LinkButton>
        </div>
      </EmptyStateActions>
    </EmptyState>
  );
};
