"use client";

import {
  ActionFormSubmit,
  useActionFormState,
} from "@publira/ui-components/action-form";
import { createContext, use } from "react";
import type { ReactNode } from "react";

import type { FollowActionState } from "#lib/follow-actions";

const FollowingContext = createContext<boolean | null>(null);

const useFollowing = (): boolean => {
  const following = use(FollowingContext);
  if (following === null) {
    throw new Error(
      "FollowButtonFollow and FollowButtonUnfollow must be rendered inside a FollowButton."
    );
  }
  return following;
};

/**
 * Whether the reader follows, as the last toggle left it: the Action answers
 * with the state it reached, and until it has, the state the page was read
 * with. The `intent` the next submission sends is the opposite of it.
 */
export const FollowButtonState = ({
  children,
  isFollowing,
}: {
  children: ReactNode;
  isFollowing: boolean;
}) => {
  const state = useActionFormState<NonNullable<FollowActionState>>();
  const following = state?.ok ? state.isFollowing : isFollowing;

  return (
    <FollowingContext value={following}>
      <input
        name="intent"
        type="hidden"
        value={following ? "unfollow" : "follow"}
      />
      {children}
    </FollowingContext>
  );
};

/** The submit control while the reader is not following yet. */
export const FollowButtonFollow = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) =>
  useFollowing() ? null : (
    <ActionFormSubmit
      aria-label={ariaLabel}
      aria-pressed={false}
      className="shrink-0"
      size="lg"
      variant="outline"
    >
      {children}
    </ActionFormSubmit>
  );

/** The submit control while the reader is following. */
export const FollowButtonUnfollow = ({
  "aria-label": ariaLabel,
  children,
}: {
  "aria-label": string;
  children: ReactNode;
}) =>
  useFollowing() ? (
    <ActionFormSubmit
      aria-label={ariaLabel}
      aria-pressed
      className="shrink-0"
      size="lg"
      variant="outline"
    >
      {children}
    </ActionFormSubmit>
  ) : null;
