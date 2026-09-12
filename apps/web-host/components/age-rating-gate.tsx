"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { SkeletonLine } from "@publira/ui-components/skeleton";
import type { ReactNode } from "react";
import { Suspense } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";
import { ageRatingMeetsConfirmation } from "#lib/age-rating";
import type { RestrictedAgeRating } from "#lib/age-rating";
import {
  useConfirmedAgeRating,
  writeConfirmedAgeRating,
} from "#lib/age-rating-confirmation";
import type { HostMessageKey } from "#lib/messages";
import { useTenantId } from "#lib/use-tenant-id";

/**
 * What stands where a rated series or episode body would be, until this
 * browser confirms the rating. The cached page stays shared: everyone is
 * served the interstitial, and confirmation is read from `localStorage` after
 * mount, so a first-time visitor never sees the body in the HTML.
 */
export const AgeRatingGate = ({
  backHref,
  backMessage,
  children,
  rating,
  seriesTitle,
}: {
  backHref: string;
  backMessage: HostMessageKey;
  children: ReactNode;
  rating?: RestrictedAgeRating;
  seriesTitle: string;
}) => {
  const tenantId = useTenantId();
  const confirmed = useConfirmedAgeRating(tenantId);

  if (ageRatingMeetsConfirmation(rating, confirmed)) {
    return children;
  }

  const titleMessage: HostMessageKey =
    rating === "r18"
      ? "host.series.age_gate.r18_title"
      : "host.series.age_gate.r15_title";
  const descriptionMessage: HostMessageKey =
    rating === "r18"
      ? "host.series.age_gate.r18_description"
      : "host.series.age_gate.r15_description";
  const confirmMessage: HostMessageKey =
    rating === "r18"
      ? "host.series.age_gate.confirm_r18"
      : "host.series.age_gate.confirm_r15";

  const onConfirm = () => {
    if (rating) {
      writeConfirmedAgeRating(tenantId, rating);
    }
  };

  return (
    <main className="mx-auto grid max-w-6xl px-6 py-10">
      <EmptyState>
        <EmptyStateHeading>
          <EmptyStateTitle>
            <Suspense fallback={<SkeletonLine className="h-5 w-64" />}>
              <ClientMessage
                message={titleMessage}
                values={{ title: seriesTitle }}
              />
            </Suspense>
          </EmptyStateTitle>
          <EmptyStateDescription>
            <Suspense
              fallback={<SkeletonLine className="h-4 w-full max-w-md" />}
            >
              <ClientMessage message={descriptionMessage} />
            </Suspense>
          </EmptyStateDescription>
        </EmptyStateHeading>
        <EmptyStateActions>
          <div className="flex flex-wrap justify-center gap-3">
            <Button
              onClick={onConfirm}
              size="lg"
              type="button"
              variant="secondary"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-36" />}>
                <ClientMessage message={confirmMessage} />
              </Suspense>
            </Button>
            <LinkButton
              render={<LocaleLink href={backHref} />}
              variant="outline"
            >
              <Suspense fallback={<SkeletonLine className="h-4 w-28" />}>
                <ClientMessage message={backMessage} />
              </Suspense>
            </LinkButton>
          </div>
        </EmptyStateActions>
      </EmptyState>
    </main>
  );
};
