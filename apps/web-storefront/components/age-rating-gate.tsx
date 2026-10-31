"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import * as EmptyState from "@publira/ui-components/empty-state";
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
 * <AgeRatingGate.Root provenAgeRating={…} rating={…}>
 *   <AgeRatingGate.Confirmation>
 *     <AgeRatingGate.Heading>
 *       <AgeRatingGate.Title>…</AgeRatingGate.Title>
 *       <AgeRatingGate.Description />
 *     </AgeRatingGate.Heading>
 *     <AgeRatingGate.Actions>
 *       <AgeRatingGate.Confirm />
 *       <AgeRatingGate.Back href="/">…</AgeRatingGate.Back>
 *     </AgeRatingGate.Actions>
 *   </AgeRatingGate.Confirmation>
 *   <AgeRatingGate.Content>…</AgeRatingGate.Content>
 * </AgeRatingGate.Root>
 * ```
 */
const AgeRatingGate = ({
  children,
  provenAgeRating,
  rating,
}: {
  /** `AgeRatingGate.Confirmation` and `AgeRatingGate.Content`. */
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
const AgeRatingGateContent = ({ children }: { children: ReactNode }) => {
  const { open } = useAgeRatingGateState();

  return open ? children : null;
};

/** The interstitial: why the page is closed, and the two ways out. */
const AgeRatingGateConfirmation = ({ children }: { children: ReactNode }) => {
  const { open } = useAgeRatingGateState();

  return open ? null : (
    <div className="mx-auto grid max-w-6xl px-6 py-10">
      <EmptyState.Root>{children}</EmptyState.Root>
    </div>
  );
};

const AgeRatingGateHeading = ({ children }: { children: ReactNode }) => (
  <EmptyState.Heading>{children}</EmptyState.Heading>
);

const AgeRatingGateTitle = ({ children }: { children: ReactNode }) => (
  <EmptyState.Title>{children}</EmptyState.Title>
);

/**
 * What confirming asserts, worded for the gate's rating. A gate standing in
 * front of something other than a series says it in `children`.
 */
const AgeRatingGateDescription = ({ children }: { children?: ReactNode }) => {
  const { rating } = useAgeRatingGateState();

  return (
    <EmptyState.Description>
      {children ??
        (rating === "r18" ? (
          <ClientMessage message="storefront.series.age_gate.r18_description" />
        ) : (
          <ClientMessage message="storefront.series.age_gate.r15_description" />
        ))}
    </EmptyState.Description>
  );
};

const AgeRatingGateActions = ({ children }: { children: ReactNode }) => (
  <EmptyState.Actions>
    <div className="flex flex-wrap justify-center gap-3">{children}</div>
  </EmptyState.Actions>
);

/** Stores the reader's confirmation of the gate's rating, which opens it. */
const AgeRatingGateConfirm = () => {
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
        <ClientMessage message="storefront.series.age_gate.confirm_r18" />
      ) : (
        <ClientMessage message="storefront.series.age_gate.confirm_r15" />
      )}
    </Button>
  );
};

/** The way out for a reader who does not confirm. */
const AgeRatingGateBack = ({
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

export {
  AgeRatingGate as Root,
  AgeRatingGateActions as Actions,
  AgeRatingGateBack as Back,
  AgeRatingGateConfirm as Confirm,
  AgeRatingGateConfirmation as Confirmation,
  AgeRatingGateContent as Content,
  AgeRatingGateDescription as Description,
  AgeRatingGateHeading as Heading,
  AgeRatingGateTitle as Title,
};
