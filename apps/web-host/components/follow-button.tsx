"use client";

import {
  ActionFormIdle,
  ActionFormPending,
} from "@publira/ui-components/action-form";
import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import { Skeleton } from "@publira/ui-components/skeleton";
import Link from "next/link";
import { createContext, useActionState, useContext, useMemo } from "react";
import type { ReactNode } from "react";

import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

import { ClientMessage } from "./client-message";
import { LocaleField } from "./locale-field";

const followButtonClassName = "shrink-0";

export const FollowControlSkeleton = () => <Skeleton className="h-10 w-28" />;

/**
 * The follow control a signed-out reader gets. `aria-label` names what signing
 * in would follow.
 */
export const FollowLoginLink = ({
  "aria-label": ariaLabel,
  href,
}: {
  "aria-label": string;
  href: string;
}) => (
  <LinkButton
    aria-label={ariaLabel}
    className={followButtonClassName}
    render={<Link href={href} />}
    size="lg"
    variant="outline"
  >
    <ClientMessage message="host.follow.follow" />
  </LinkButton>
);

interface FollowButtonState {
  following: boolean;
  isPending: boolean;
}

const FollowButtonStateContext = createContext<FollowButtonState | null>(null);

const useFollowButtonState = (): FollowButtonState => {
  const state = useContext(FollowButtonStateContext);
  if (!state) {
    throw new Error(
      "FollowButtonFollow and FollowButtonUnfollow must be rendered inside a FollowButton."
    );
  }
  return state;
};

/**
 * A toggle between following and not. The reader's current state decides
 * which of its two slots renders, so each carries the accessible name for its
 * own intent:
 *
 * ```tsx
 * <FollowButton isFollowing={…} publicId={…} returnTo={…} targetKind="series" tenantId={…}>
 *   <FollowButtonFollow aria-label={t("host.follow.follow_aria", { name })} />
 *   <FollowButtonUnfollow aria-label={t("host.follow.unfollow_aria", { name })} />
 * </FollowButton>
 * ```
 */
export const FollowButton = ({
  children,
  isFollowing,
  publicId,
  returnTo,
  targetKind,
  tenantId,
}: {
  /** `FollowButtonFollow` and `FollowButtonUnfollow`. */
  children: ReactNode;
  isFollowing: boolean;
  publicId: string;
  returnTo: string;
  targetKind: FollowTargetKind;
  tenantId: string;
}) => {
  const [state, formAction, isPending] = useActionState(
    toggleFollowAction,
    null as FollowActionState
  );
  const following = state?.ok ? state.isFollowing : isFollowing;
  const buttonState = useMemo(
    () => ({ following, isPending }),
    [following, isPending]
  );

  return (
    <form action={formAction} className="grid justify-items-start gap-2">
      <LocaleField />
      <input
        name="intent"
        type="hidden"
        value={following ? "unfollow" : "follow"}
      />
      <input name="publicId" type="hidden" value={publicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="targetKind" type="hidden" value={targetKind} />
      <input name="tenantId" type="hidden" value={tenantId} />
      <FollowButtonStateContext value={buttonState}>
        {children}
      </FollowButtonStateContext>
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};

const FollowSubmit = ({
  "aria-label": ariaLabel,
  children,
  following,
}: {
  "aria-label": string;
  children: ReactNode;
  following: boolean;
}) => {
  const { isPending } = useFollowButtonState();

  return (
    <Button
      aria-busy={isPending}
      aria-label={ariaLabel}
      aria-pressed={following}
      className={followButtonClassName}
      disabled={isPending}
      size="lg"
      type="submit"
      variant="outline"
    >
      <ActionFormIdle>{children}</ActionFormIdle>
      <ActionFormPending>
        <ClientMessage message="host.follow.pending" />
      </ActionFormPending>
    </Button>
  );
};

/** The submit control while the reader is not following yet. */
export const FollowButtonFollow = ({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) => {
  const { following } = useFollowButtonState();

  return following ? null : (
    <FollowSubmit aria-label={ariaLabel} following={false}>
      <ClientMessage message="host.follow.follow" />
    </FollowSubmit>
  );
};

/** The submit control while the reader is following. */
export const FollowButtonUnfollow = ({
  "aria-label": ariaLabel,
}: {
  "aria-label": string;
}) => {
  const { following } = useFollowButtonState();

  return following ? (
    <FollowSubmit aria-label={ariaLabel} following>
      <ClientMessage message="host.follow.unfollow" />
    </FollowSubmit>
  ) : null;
};
