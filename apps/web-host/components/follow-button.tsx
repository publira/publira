"use client";

import { Button, LinkButton } from "@publira/ui-components/button";
import { FormMessage } from "@publira/ui-components/form-message";
import Link from "next/link";
import { useActionState } from "react";

import type { FollowTargetKind } from "#lib/follow";
import type { FollowActionState } from "#lib/follow-actions";
import { toggleFollowAction } from "#lib/follow-actions";

import { LocaleField } from "./locale-field";

/**
 * The control's copy, resolved on the server. Every string here lands in a
 * button label or an `aria-label`, neither of which can take a node, so this
 * arrives as plain strings rather than as `ReactNode`.
 */
export interface FollowButtonCopy {
  follow: string;
  followAriaLabel: string;
  pending: string;
  unfollow: string;
  unfollowAriaLabel: string;
}

const followButtonClassName = "shrink-0";

export const FollowControlSkeleton = () => (
  <div
    aria-hidden="true"
    className="h-9 w-28 animate-pulse rounded-md bg-muted"
  />
);

export const FollowLoginLink = ({
  ariaLabel,
  href,
  label,
}: {
  ariaLabel: string;
  href: string;
  label: string;
}) => (
  <LinkButton
    aria-label={ariaLabel}
    className={followButtonClassName}
    render={<Link href={href} />}
    size="sm"
    variant="outline"
  >
    {label}
  </LinkButton>
);

export const FollowButton = ({
  copy,
  isFollowing,
  publicId,
  returnTo,
  targetKind,
  tenantId,
}: {
  copy: FollowButtonCopy;
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
  const intent = following ? "unfollow" : "follow";
  const label = following ? copy.unfollowAriaLabel : copy.followAriaLabel;
  let buttonLabel = copy.follow;
  if (isPending) {
    buttonLabel = copy.pending;
  } else if (following) {
    buttonLabel = copy.unfollow;
  }

  return (
    <form action={formAction} className="grid justify-items-end gap-2">
      <LocaleField />
      <input name="intent" type="hidden" value={intent} />
      <input name="publicId" type="hidden" value={publicId} />
      <input name="returnTo" type="hidden" value={returnTo} />
      <input name="targetKind" type="hidden" value={targetKind} />
      <input name="tenantId" type="hidden" value={tenantId} />
      <Button
        aria-busy={isPending}
        aria-label={label}
        aria-pressed={following}
        className={followButtonClassName}
        disabled={isPending}
        size="sm"
        type="submit"
        variant={following ? "outline" : "default"}
      >
        {buttonLabel}
      </Button>
      {state ? (
        <FormMessage variant={state.ok ? "success" : "destructive"}>
          {state.message}
        </FormMessage>
      ) : null}
    </form>
  );
};
