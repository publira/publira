"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import {
  EmptyState,
  EmptyStateActions,
  EmptyStateDescription,
  EmptyStateHeading,
  EmptyStateTitle,
} from "@publira/ui-components/empty-state";
import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import { ClientMessage } from "#components/client-message";
import { LocaleLink } from "#components/locale-link";
import { ageRatingSatisfiedBy } from "#lib/age-rating";
import type { RestrictedAgeRating } from "#lib/age-rating";
import {
  useConfirmedAgeRating,
  writeConfirmedAgeRating,
} from "#lib/age-rating-confirmation";
import { useTenantId } from "#lib/use-tenant-id";

interface AgeRatingGateState {
  open: boolean;
  rating?: RestrictedAgeRating;
}

const AgeRatingGateContext = createContext<AgeRatingGateState | null>(null);

const useAgeRatingGateState = (): AgeRatingGateState => {
  const state = useContext(AgeRatingGateContext);
  if (!state) {
    throw new Error(
      "AgeRatingGate slots must be rendered inside an AgeRatingGate."
    );
  }
  return state;
};

/**
 * What stands where a rated series or episode body would be, until this
 * browser confirms the rating. The cached page stays shared: everyone is
 * served the interstitial, and confirmation is read from `localStorage` after
 * mount, so a first-time visitor never sees the body in the HTML.
 *
 * `provenAgeRating` is what the reader's own birth date already carries, so a
 * reader the tenant has verified is never asked to say it again.
 *
 * ```tsx
 * <AgeRatingGate provenAgeRating={…} rating={…}>
 *   <AgeRatingGateConfirmation>
 *     <AgeRatingGateHeading>
 *       <AgeRatingGateTitle>…</AgeRatingGateTitle>
 *       <AgeRatingGateDescription />
 *     </AgeRatingGateHeading>
 *     <AgeRatingGateActions>
 *       <AgeRatingGateConfirm />
 *       <AgeRatingGateBack href="/">…</AgeRatingGateBack>
 *     </AgeRatingGateActions>
 *   </AgeRatingGateConfirmation>
 *   <AgeRatingGateContent>…</AgeRatingGateContent>
 * </AgeRatingGate>
 * ```
 */
export const AgeRatingGate = ({
  children,
  provenAgeRating,
  rating,
}: {
  /** `AgeRatingGateConfirmation` and `AgeRatingGateContent`. */
  children: ReactNode;
  provenAgeRating?: RestrictedAgeRating;
  rating?: RestrictedAgeRating;
}) => {
  const tenantId = useTenantId();
  const confirmed = useConfirmedAgeRating(tenantId);
  const open =
    ageRatingSatisfiedBy(rating, provenAgeRating) ||
    ageRatingSatisfiedBy(rating, confirmed);
  const state = useMemo(() => ({ open, rating }), [open, rating]);

  return <AgeRatingGateContext value={state}>{children}</AgeRatingGateContext>;
};

/** The gated body, rendered once the rating is satisfied. */
export const AgeRatingGateContent = ({ children }: { children: ReactNode }) => {
  const { open } = useAgeRatingGateState();

  return open ? children : null;
};

/** The interstitial: why the page is closed, and the two ways out. */
export const AgeRatingGateConfirmation = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { open } = useAgeRatingGateState();

  return open ? null : (
    <div className="mx-auto grid max-w-6xl px-6 py-10">
      <EmptyState>{children}</EmptyState>
    </div>
  );
};

export const AgeRatingGateHeading = ({ children }: { children: ReactNode }) => (
  <EmptyStateHeading>{children}</EmptyStateHeading>
);

export const AgeRatingGateTitle = ({ children }: { children: ReactNode }) => (
  <EmptyStateTitle>{children}</EmptyStateTitle>
);

/** What confirming asserts, worded for the gate's rating. */
export const AgeRatingGateDescription = () => {
  const { rating } = useAgeRatingGateState();

  return (
    <EmptyStateDescription>
      {rating === "r18" ? (
        <ClientMessage message="host.series.age_gate.r18_description" />
      ) : (
        <ClientMessage message="host.series.age_gate.r15_description" />
      )}
    </EmptyStateDescription>
  );
};

export const AgeRatingGateActions = ({ children }: { children: ReactNode }) => (
  <EmptyStateActions>
    <div className="flex flex-wrap justify-center gap-3">{children}</div>
  </EmptyStateActions>
);

/** Stores the reader's confirmation of the gate's rating, which opens it. */
export const AgeRatingGateConfirm = () => {
  const { rating } = useAgeRatingGateState();
  const tenantId = useTenantId();

  const onConfirm = () => {
    if (rating) {
      writeConfirmedAgeRating(tenantId, rating);
    }
  };

  return (
    <Button onClick={onConfirm} size="lg" type="button" variant="secondary">
      {rating === "r18" ? (
        <ClientMessage message="host.series.age_gate.confirm_r18" />
      ) : (
        <ClientMessage message="host.series.age_gate.confirm_r15" />
      )}
    </Button>
  );
};

/** The way out for a reader who does not confirm. */
export const AgeRatingGateBack = ({
  children,
  href,
}: {
  children: ReactNode;
  href: string;
}) => (
  <LinkButton render={<LocaleLink href={href} />} variant="outline">
    {children}
  </LinkButton>
);
