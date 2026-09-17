"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";
import { ageRatingSatisfiedBy } from "#lib/age-rating";
import type { RestrictedAgeRating } from "#lib/age-rating";
import {
  useConfirmedAgeRating,
  writeConfirmedAgeRating,
} from "#lib/age-rating-confirmation";
import type { HostClientMessageKey } from "#lib/messages";
import { useTenantId } from "#lib/use-tenant-id";

/** The interstitial itself: why the page is closed, and the two ways out. */
const AgeRatingConfirmation = ({
  backHref,
  backMessage,
  rating,
  seriesTitle,
}: {
  backHref: string;
  backMessage: HostClientMessageKey;
  rating?: RestrictedAgeRating;
  seriesTitle: string;
}) => {
  const tenantId = useTenantId();

  const titleMessage: HostClientMessageKey =
    rating === "r18"
      ? "host.series.age_gate.r18_title"
      : "host.series.age_gate.r15_title";
  const descriptionMessage: HostClientMessageKey =
    rating === "r18"
      ? "host.series.age_gate.r18_description"
      : "host.series.age_gate.r15_description";
  const confirmMessage: HostClientMessageKey =
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
            <ClientMessage
              message={titleMessage}
              values={{ title: seriesTitle }}
            />
          </EmptyStateTitle>
          <EmptyStateDescription>
            <ClientMessage message={descriptionMessage} />
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
              <ClientMessage message={confirmMessage} />
            </Button>
            <LinkButton
              render={<LocaleLink href={backHref} />}
              variant="outline"
            >
              <ClientMessage message={backMessage} />
            </LinkButton>
          </div>
        </EmptyStateActions>
      </EmptyState>
    </main>
  );
};

/**
 * What stands where a rated series or episode body would be, until this
 * browser confirms the rating. The cached page stays shared: everyone is
 * served the interstitial, and confirmation is read from `localStorage` after
 * mount, so a first-time visitor never sees the body in the HTML.
 *
 * `provenAgeRating` is what the reader's own birth date already carries, so a
 * reader the tenant has verified is never asked to say it again.
 */
export const AgeRatingGate = ({
  backHref,
  backMessage,
  children,
  provenAgeRating,
  rating,
  seriesTitle,
}: {
  backHref: string;
  backMessage: HostClientMessageKey;
  children: ReactNode;
  provenAgeRating?: RestrictedAgeRating;
  rating?: RestrictedAgeRating;
  seriesTitle: string;
}) => {
  const tenantId = useTenantId();
  const confirmed = useConfirmedAgeRating(tenantId);

  if (
    ageRatingSatisfiedBy(rating, provenAgeRating) ||
    ageRatingSatisfiedBy(rating, confirmed)
  ) {
    return children;
  }

  return (
    <AgeRatingConfirmation
      backHref={backHref}
      backMessage={backMessage}
      rating={rating}
      seriesTitle={seriesTitle}
    />
  );
};
